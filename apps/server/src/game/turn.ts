import { eq, and, sql, ne } from 'drizzle-orm';
import type { Database, Transaction } from '../db/connection.js';
import { matches, rounds, hands, actions, turnHandoffs } from '../db/schema.js';
import { createPreflopState, createPostflopState, legalActions as engineLegalActions, applyAction as engineApplyAction, nextStreet, bothAllIn } from '../engine/streets.js';
import { resolveShowdown } from '../engine/showdown.js';
import { dealFromSeed, boardForStreet } from '../engine/deck.js';
import { getAvailableChips, assertLedgerInvariant } from './ledger.js';
import type { ActionType, Card, Street, Action } from '../engine/types.js';
import { getMatchState } from './match.js';
import { logEvent } from '../events/logger.js';
import { dispatchPush } from '../notif/apns.js';

export interface ApplyActionInput {
  handId: string;
  userId: string;
  actionType: ActionType;
  amount: number;
  clientTxId: string;
  clientSentAt?: Date;
}

/**
 * Apply an action to a hand. This is the core game mutation.
 * Runs inside a transaction with SELECT FOR UPDATE on the match.
 */
export async function applyAction(db: Database, input: ApplyActionInput) {
  const pendingHandoffs: { handoffId: string; toUserId: string; roundId: string }[] = [];

  const result = await db.transaction(async (tx) => {
    // 1. Load hand and verify state
    const hand = await tx.query.hands.findFirst({
      where: eq(hands.handId, input.handId),
    });
    if (!hand) throw new Error(`Hand ${input.handId} not found`);
    if (hand.status !== 'in_progress') throw new Error('Hand is not in progress');
    if (hand.actionOnUserId !== input.userId) throw new Error('Not your turn in this hand');

    // 2. Load round and lock match
    const round = await tx.query.rounds.findFirst({
      where: eq(rounds.roundId, hand.roundId),
    });
    if (!round) throw new Error('Round not found');

    await tx.execute(sql`SELECT * FROM matches WHERE match_id = ${round.matchId} FOR UPDATE`);

    const match = await tx.query.matches.findFirst({
      where: eq(matches.matchId, round.matchId),
    });
    if (!match) throw new Error('Match not found');

    // 3. Check idempotency
    const existingAction = await tx.query.actions.findFirst({
      where: and(
        eq(actions.handId, input.handId),
        eq(actions.clientTxId, input.clientTxId),
      ),
    });
    if (existingAction) {
      // Return the current state — idempotent
      return getMatchState(tx, match.matchId, input.userId);
    }

    // 4. Build engine state from DB
    const isUserA = match.userAId === input.userId;
    const opponentId = isUserA ? match.userBId : match.userAId;

    const { available: myAvailable } = await getAvailableChips(tx, match.matchId, input.userId);
    const { available: oppAvailable } = await getAvailableChips(tx, match.matchId, opponentId);

    const myReserved = isUserA ? hand.userAReserved : hand.userBReserved;
    const oppReserved = isUserA ? hand.userBReserved : hand.userAReserved;

    // Load all actions for this hand on this street to determine current bet state
    const streetActions = await tx.query.actions.findMany({
      where: and(
        eq(actions.handId, hand.handId),
        eq(actions.street, hand.street),
      ),
    });

    // Reconstruct current bet level from actions
    let currentBet = 0;
    let lastRaiseSize = 0;
    let actionsThisStreet = streetActions.length;

    if (hand.street === 'preflop') {
      // Preflop starts with blinds
      currentBet = match.blindBig;
      lastRaiseSize = match.blindBig;
    }

    // Replay street actions to find current bet level
    for (const a of streetActions) {
      if (a.actionType === 'bet' || a.actionType === 'raise' || a.actionType === 'all_in') {
        const actorReserved = a.actingUserId === match.userAId ? hand.userAReserved : hand.userBReserved;
        // The pot_after minus previous pot gives us the contribution
        if (a.amount + (a.actingUserId === match.userAId ?
          (hand.userAReserved - a.amount) : (hand.userBReserved - a.amount)) > currentBet) {
          lastRaiseSize = a.amount;
        }
      }
    }

    // Build the engine state
    const engineState = {
      street: hand.street as Street,
      pot: hand.pot,
      currentBet: Math.max(isUserA ? hand.userAReserved : hand.userBReserved,
                           isUserA ? hand.userBReserved : hand.userAReserved),
      lastRaiseSize: lastRaiseSize || match.blindBig,
      sbUserId: round.sbUserId,
      bbUserId: round.bbUserId,
      actionOnUserId: input.userId,
      players: [
        {
          userId: input.userId,
          available: myAvailable,
          reservedInHand: myReserved,
          isAllIn: myAvailable === 0 && myReserved > 0,
        },
        {
          userId: opponentId,
          available: oppAvailable,
          reservedInHand: oppReserved,
          isAllIn: oppAvailable === 0 && oppReserved > 0,
        },
      ] as [typeof arguments[0] extends never ? never : { userId: string; available: number; reservedInHand: number; isAllIn: boolean }, { userId: string; available: number; reservedInHand: number; isAllIn: boolean }],
      actionsThisStreet,
      streetClosed: false,
      isTerminal: false,
    };

    // 5. Validate and apply action using engine
    const action: Action = { type: input.actionType, amount: input.amount };
    const legal = engineLegalActions(engineState);
    if (!legal.actions.includes(input.actionType)) {
      throw new Error(`Illegal action: ${input.actionType}. Legal: ${legal.actions.join(', ')}`);
    }

    // Validate amounts
    if (input.actionType === 'bet' || input.actionType === 'raise') {
      if (input.amount <= 0) throw new Error('Bet/raise amount must be positive');
      if (input.amount > myAvailable) throw new Error(`Amount ${input.amount} exceeds available ${myAvailable}`);
    }

    const newState = engineApplyAction(engineState, action);

    // 6. Apply mutations to DB
    const myNewReserved = newState.players.find(p => p.userId === input.userId)!.reservedInHand;
    const oppNewReserved = newState.players.find(p => p.userId === opponentId)!.reservedInHand;

    // Record the action
    await tx.insert(actions).values({
      handId: hand.handId,
      street: hand.street,
      actingUserId: input.userId,
      actionType: input.actionType,
      amount: input.amount,
      potAfter: newState.pot,
      clientTxId: input.clientTxId,
      clientSentAt: input.clientSentAt,
    });

    // Update hand reserved chips
    const handUpdate: Record<string, unknown> = {
      pot: newState.pot,
      userAReserved: isUserA ? myNewReserved : oppNewReserved,
      userBReserved: isUserA ? oppNewReserved : myNewReserved,
    };

    if (newState.isTerminal) {
      if (newState.terminalReason === 'fold') {
        // Fold: opponent wins the pot
        handUpdate.status = 'complete';
        handUpdate.street = 'complete';
        handUpdate.terminalReason = 'fold';
        handUpdate.winnerUserId = newState.winnerUserId;
        handUpdate.actionOnUserId = null;
        handUpdate.completedAt = new Date();

        // Award pot to winner and return reserved to players
        const winnerId = newState.winnerUserId!;
        const isWinnerA = winnerId === match.userAId;
        const winnerReserved = isWinnerA ? (handUpdate.userAReserved as number) : (handUpdate.userBReserved as number);
        const loserReserved = isWinnerA ? (handUpdate.userBReserved as number) : (handUpdate.userAReserved as number);

        // Winner gets the whole pot; both players' reserved returns to 0
        // total_chips change: winner += pot - their_reserved; loser -= their_reserved
        // Simpler: winner gains loser's reserved; loser loses their reserved
        if (isWinnerA) {
          await tx.update(matches).set({
            userATotal: sql`${matches.userATotal} + ${loserReserved}`,
            userBTotal: sql`${matches.userBTotal} - ${loserReserved}`,
          }).where(eq(matches.matchId, match.matchId));
        } else {
          await tx.update(matches).set({
            userATotal: sql`${matches.userATotal} - ${handUpdate.userAReserved as number}`,
            userBTotal: sql`${matches.userBTotal} + ${handUpdate.userAReserved as number}`,
          }).where(eq(matches.matchId, match.matchId));
        }

        // Clear reserved after awarding
        handUpdate.userAReserved = 0;
        handUpdate.userBReserved = 0;

        // Discard folder's hole cards (spec §11)
        const folderId = input.userId;
        if (folderId === match.userAId) {
          handUpdate.userAHole = [];
        } else {
          handUpdate.userBHole = [];
        }

        await logEvent(tx, input.userId, 'hand_completed', {
          hand_id: hand.handId,
          reason: 'fold',
          winner: winnerId,
        });
      }
    } else if (newState.streetClosed) {
      // Street closed — check if both all-in or advance street
      if (bothAllIn(newState)) {
        // Both all-in — hand goes to awaiting_runout
        handUpdate.status = 'awaiting_runout';
        handUpdate.actionOnUserId = null;
      } else {
        // Advance to next street
        const next = nextStreet(hand.street as Street);
        if (next === 'showdown') {
          // River betting complete — resolve showdown
          const dealt = dealFromSeed(hand.deckSeed);
          const board = boardForStreet(dealt, 'river');
          const userAHole = hand.userAHole as Card[];
          const userBHole = hand.userBHole as Card[];

          const showdownResult = resolveShowdown(
            userAHole, userBHole, board,
            newState.pot, match.userAId, match.userBId, round.bbUserId,
          );

          handUpdate.status = 'complete';
          handUpdate.street = 'complete';
          handUpdate.terminalReason = 'showdown';
          handUpdate.winnerUserId = showdownResult.winnerUserId;
          handUpdate.actionOnUserId = null;
          handUpdate.board = board;
          handUpdate.completedAt = new Date();

          // Award chips
          for (const award of showdownResult.awards) {
            const awardReserved = award.userId === match.userAId
              ? (handUpdate.userAReserved as number) : (handUpdate.userBReserved as number);
            if (award.userId === match.userAId) {
              await tx.update(matches).set({
                userATotal: sql`${matches.userATotal} + ${award.amount} - ${handUpdate.userAReserved}`,
              }).where(eq(matches.matchId, match.matchId));
            } else {
              await tx.update(matches).set({
                userBTotal: sql`${matches.userBTotal} + ${award.amount} - ${handUpdate.userBReserved}`,
              }).where(eq(matches.matchId, match.matchId));
            }
          }

          handUpdate.userAReserved = 0;
          handUpdate.userBReserved = 0;

          await logEvent(tx, input.userId, 'hand_completed', {
            hand_id: hand.handId,
            reason: 'showdown',
            winner: showdownResult.winnerUserId,
          });
        } else {
          // Deal next street's community cards
          const dealt = dealFromSeed(hand.deckSeed);
          const board = boardForStreet(dealt, next);

          handUpdate.street = next;
          handUpdate.board = board;
          // Postflop: BB acts first
          handUpdate.actionOnUserId = round.bbUserId;
        }
      }
    } else {
      // Action passed to opponent
      handUpdate.actionOnUserId = newState.actionOnUserId;
    }

    await tx.update(hands)
      .set(handUpdate)
      .where(eq(hands.handId, hand.handId));

    // 7. Check turn handoff at round level
    const allHands = await tx.query.hands.findMany({
      where: eq(hands.roundId, hand.roundId),
    });

    const myPending = allHands.filter(h =>
      h.handId === hand.handId
        ? (handUpdate.actionOnUserId === input.userId && handUpdate.status !== 'complete' && handUpdate.status !== 'awaiting_runout')
        : (h.status === 'in_progress' && h.actionOnUserId === input.userId)
    ).length;

    const oppPending = allHands.filter(h =>
      h.handId === hand.handId
        ? (handUpdate.actionOnUserId === opponentId && handUpdate.status !== 'complete' && handUpdate.status !== 'awaiting_runout')
        : (h.status === 'in_progress' && h.actionOnUserId === opponentId)
    ).length;

    // If my pending is now 0 and opponent has pending, it's a turn handoff
    if (myPending === 0 && oppPending > 0) {
      const [handoff] = await tx.insert(turnHandoffs).values({
        roundId: hand.roundId,
        fromUserId: input.userId,
        toUserId: opponentId,
      }).returning();

      pendingHandoffs.push({
        handoffId: handoff.handoffId,
        toUserId: opponentId,
        roundId: hand.roundId,
      });

      await logEvent(tx, input.userId, 'turn_submitted', {
        round_id: hand.roundId,
        to_user_id: opponentId,
      });
    }

    // If both pending are 0, round is ready for reveal/advance
    if (myPending === 0 && oppPending === 0) {
      // Check if any hands are awaiting_runout
      const updatedHands = await tx.query.hands.findMany({
        where: eq(hands.roundId, hand.roundId),
      });
      const hasAwaitingRunout = updatedHands.some(h =>
        h.handId === hand.handId
          ? handUpdate.status === 'awaiting_runout'
          : h.status === 'awaiting_runout'
      );

      if (hasAwaitingRunout) {
        await tx.update(rounds).set({ status: 'revealing' }).where(eq(rounds.roundId, hand.roundId));
      } else {
        // All hands are complete — round can auto-complete
        await tx.update(rounds).set({
          status: 'complete',
          completedAt: new Date(),
        }).where(eq(rounds.roundId, hand.roundId));

        await logEvent(tx, input.userId, 'round_completed', {
          round_id: hand.roundId,
        });
      }
    }

    await assertLedgerInvariant(tx, match.matchId);

    return getMatchState(tx, match.matchId, input.userId);
  });

  // Post-commit: dispatch APNS for any turn handoffs
  for (const handoff of pendingHandoffs) {
    try {
      await dispatchPush(handoff.toUserId, handoff.handoffId, handoff.roundId);
    } catch (err) {
      // Don't fail the request if push fails
      console.error('Failed to dispatch push:', err);
    }
  }

  return result;
}

/**
 * Get legal actions for a hand from the perspective of the requesting user.
 */
export async function getLegalActions(db: Database, handId: string, userId: string) {
  const hand = await db.query.hands.findFirst({
    where: eq(hands.handId, handId),
  });
  if (!hand) throw new Error(`Hand ${handId} not found`);
  if (hand.status !== 'in_progress') {
    return { actions: [], min_raise: 0, max_bet: 0, call_amount: 0, pot_size: hand.pot };
  }
  if (hand.actionOnUserId !== userId) {
    return { actions: [], min_raise: 0, max_bet: 0, call_amount: 0, pot_size: hand.pot };
  }

  const round = await db.query.rounds.findFirst({
    where: eq(rounds.roundId, hand.roundId),
  });
  if (!round) throw new Error('Round not found');

  const match = await db.query.matches.findFirst({
    where: eq(matches.matchId, round.matchId),
  });
  if (!match) throw new Error('Match not found');

  const isUserA = match.userAId === userId;
  const opponentId = isUserA ? match.userBId : match.userAId;

  const { available: myAvailable } = await getAvailableChips(db, match.matchId, userId);
  const { available: oppAvailable } = await getAvailableChips(db, match.matchId, opponentId);

  const myReserved = isUserA ? hand.userAReserved : hand.userBReserved;
  const oppReserved = isUserA ? hand.userBReserved : hand.userAReserved;

  const currentBet = Math.max(myReserved, oppReserved);

  const engineState = {
    street: hand.street as Street,
    pot: hand.pot,
    currentBet,
    lastRaiseSize: match.blindBig,
    sbUserId: round.sbUserId,
    bbUserId: round.bbUserId,
    actionOnUserId: userId,
    players: [
      { userId, available: myAvailable, reservedInHand: myReserved, isAllIn: false },
      { userId: opponentId, available: oppAvailable, reservedInHand: oppReserved, isAllIn: false },
    ] as [{ userId: string; available: number; reservedInHand: number; isAllIn: boolean }, { userId: string; available: number; reservedInHand: number; isAllIn: boolean }],
    actionsThisStreet: 0,
    streetClosed: false,
    isTerminal: false,
  };

  const legal = engineLegalActions(engineState);

  return {
    actions: legal.actions,
    min_raise: legal.minRaise,
    max_bet: legal.maxBet,
    call_amount: legal.callAmount,
    pot_size: legal.potSize,
    available_after_min_raise: myAvailable - legal.minRaise,
    available_after_max_bet: myAvailable - legal.maxBet,
  };
}

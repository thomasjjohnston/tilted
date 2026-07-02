import { eq, and, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/connection.js';
import { matches, rounds, hands, actions, turnHandoffs } from '../db/schema.js';
import {
  legalActions as engineLegalActions,
  applyAction as engineApplyAction,
  nextStreet,
  bothAllIn,
} from '../engine/streets.js';
import { resolveShowdown } from '../engine/showdown.js';
import { dealFromSeed, boardForStreet } from '../engine/deck.js';
import { getAvailableChips, assertLedgerInvariant } from './ledger.js';
import type { ActionType, Card, Street, BettingState, PlayerState } from '../engine/types.js';
import { getMatchState } from './match.js';
import { logEvent } from '../events/logger.js';
import { dispatch } from '../notif/dispatchers.js';
import { enqueueReminder } from '../notif/reminder-cron.js';
import { GameRuleError } from '../errors.js';

type HandRow = typeof hands.$inferSelect;
type MatchRow = typeof matches.$inferSelect;
type RoundRow = typeof rounds.$inferSelect;

export interface ApplyActionInput {
  handId: string;
  userId: string;
  actionType: ActionType;
  amount: number;
  clientTxId: string;
  clientSentAt?: Date;
}

interface PendingNotifState {
  handoffs: { handoffId: string; toUserId: string; roundId: string; handsPending: number; fromUserId: string; matchId: string }[];
}

// ── Betting-state reconstruction ───────────────────────────────────────────────

/**
 * Build the current mid-street betting state for the hand, from the
 * perspective of the requesting user (who is the actor).
 *
 * This is the single source of truth for "what is the betting situation
 * on this hand right now" — used by BOTH `getLegalActions` (what the bet
 * sheet advertises) and the action-application path (what the engine
 * enforces). Because both derive `currentBet`/`lastRaiseSize` from the
 * identical logic, the min-raise the client shows can never diverge from
 * the one the server enforces — the root cause of the "invalid raise
 * bounces the hand back" bug (beta feedback S7-4).
 *
 * `currentBet` is the larger of the two players' reserved chips, and the
 * outstanding raise the actor faces (`currentBet − myReserved`) IS the
 * last raise size — the actor is behind by exactly it (they had matched
 * the prior level). The engine floors the min-raise at one big blind, so
 * this is exact for every real spot. Derived straight from the reserved
 * columns, it needs no action replay and is robust to any hand state.
 */
export async function loadBettingState(
  db: Database | Transaction,
  hand: HandRow,
  match: MatchRow,
  round: RoundRow,
  userId: string,
): Promise<BettingState> {
  const isUserA = match.userAId === userId;
  const opponentId = isUserA ? match.userBId : match.userAId;

  const { available: myAvailable } = await getAvailableChips(db, match.matchId, userId);
  const { available: oppAvailable } = await getAvailableChips(db, match.matchId, opponentId);

  const myReserved = isUserA ? hand.userAReserved : hand.userBReserved;
  const oppReserved = isUserA ? hand.userBReserved : hand.userAReserved;
  const currentBet = Math.max(myReserved, oppReserved);
  const toCall = currentBet - myReserved;
  const lastRaiseSize = toCall > 0 ? toCall : match.blindBig;

  // Count of actions already taken on this street — the engine uses it for
  // preflop limp / street-close semantics.
  const streetActions = await db.query.actions.findMany({
    where: and(eq(actions.handId, hand.handId), eq(actions.street, hand.street)),
  });

  return {
    street: hand.street as Street,
    pot: hand.pot,
    currentBet,
    lastRaiseSize,
    sbUserId: round.sbUserId,
    bbUserId: round.bbUserId,
    actionOnUserId: userId,
    players: [
      { userId, available: myAvailable, reservedInHand: myReserved, isAllIn: myAvailable === 0 && myReserved > 0 },
      { userId: opponentId, available: oppAvailable, reservedInHand: oppReserved, isAllIn: oppAvailable === 0 && oppReserved > 0 },
    ] as [PlayerState, PlayerState],
    actionsThisStreet: streetActions.length,
    streetClosed: false,
    isTerminal: false,
  };
}

// ── Settlement ─────────────────────────────────────────────────────────────────

/**
 * Move chips when a hand completes: for each player,
 * new_total = old_total - reserved_in_hand + award. Returns per-user net
 * so callers can persist resolvedNetFor{A,B}.
 */
async function settleHand(
  tx: Transaction,
  match: MatchRow,
  aReserved: number,
  bReserved: number,
  awards: { userId: string; amount: number }[],
): Promise<{ aDelta: number; bDelta: number }> {
  const aAward = awards.find(a => a.userId === match.userAId)?.amount ?? 0;
  const bAward = awards.find(a => a.userId === match.userBId)?.amount ?? 0;
  const aDelta = aAward - aReserved;
  const bDelta = bAward - bReserved;
  await tx.update(matches).set({
    userATotal: sql`${matches.userATotal} + ${aDelta}`,
    userBTotal: sql`${matches.userBTotal} + ${bDelta}`,
  }).where(eq(matches.matchId, match.matchId));
  return { aDelta, bDelta };
}

// ── Single-action mutation (shared by single + batch paths) ────────────────────

/**
 * Validate and apply one action to one hand inside an already-open
 * transaction with the match locked. Returns false (no-op) if the action
 * was already applied (idempotent replay by client_tx_id). Throws
 * GameRuleError for any illegal action — which, in a batch, rolls back
 * the whole turn (all-or-nothing).
 */
async function applyOneActionTx(
  tx: Transaction,
  hand: HandRow,
  match: MatchRow,
  round: RoundRow,
  input: { userId: string; actionType: ActionType; amount: number; clientTxId: string; clientSentAt?: Date },
): Promise<boolean> {
  // Idempotency first, so retries after a hand completes are safe no-ops.
  const existing = await tx.query.actions.findFirst({
    where: and(eq(actions.handId, hand.handId), eq(actions.clientTxId, input.clientTxId)),
  });
  if (existing) return false;

  if (hand.status !== 'in_progress') throw new GameRuleError('Hand is not in progress');
  if (hand.actionOnUserId !== input.userId) throw new GameRuleError('Not your turn in this hand');

  const isUserA = match.userAId === input.userId;
  const opponentId = isUserA ? match.userBId : match.userAId;

  const state = await loadBettingState(tx, hand, match, round, input.userId);
  const myAvailable = state.players.find(p => p.userId === input.userId)!.available;

  const legal = engineLegalActions(state);
  if (!legal.actions.includes(input.actionType)) {
    throw new GameRuleError(`Illegal action: ${input.actionType}. Legal: ${legal.actions.join(', ')}`);
  }
  if (input.actionType === 'bet' || input.actionType === 'raise') {
    if (input.amount <= 0) throw new GameRuleError('Bet/raise amount must be positive');
    if (input.amount > myAvailable) throw new GameRuleError(`Amount ${input.amount} exceeds available ${myAvailable}`);
  }

  const newState = engineApplyAction(state, { type: input.actionType, amount: input.amount });

  const myNewReserved = newState.players.find(p => p.userId === input.userId)!.reservedInHand;
  const oppNewReserved = newState.players.find(p => p.userId === opponentId)!.reservedInHand;

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

  const handUpdate: Record<string, unknown> = {
    pot: newState.pot,
    userAReserved: isUserA ? myNewReserved : oppNewReserved,
    userBReserved: isUserA ? oppNewReserved : myNewReserved,
  };

  if (newState.isTerminal) {
    if (newState.terminalReason === 'fold') {
      const winnerId = newState.winnerUserId!;
      const aReserved = handUpdate.userAReserved as number;
      const bReserved = handUpdate.userBReserved as number;

      handUpdate.status = 'complete';
      handUpdate.street = 'complete';
      handUpdate.terminalReason = 'fold';
      // Street the fold was decided on (pre-action street) — powers
      // "folded the river" summary detail.
      handUpdate.foldStreet = hand.street;
      handUpdate.winnerUserId = winnerId;
      handUpdate.actionOnUserId = null;
      handUpdate.completedAt = new Date();

      const d = await settleHand(tx, match, aReserved, bReserved, [{ userId: winnerId, amount: newState.pot }]);
      handUpdate.resolvedNetForA = d.aDelta;
      handUpdate.resolvedNetForB = d.bDelta;
      handUpdate.userAReserved = 0;
      handUpdate.userBReserved = 0;

      // Folder's hole cards stay persisted; opponent's view is gated on
      // terminal_reason === 'showdown' at the serialization layer.
      await logEvent(tx, input.userId, 'hand_completed', {
        hand_id: hand.handId, reason: 'fold', winner: winnerId,
      });
    }
  } else if (newState.streetClosed) {
    const eitherAllIn = newState.players.some(p => p.isAllIn) || bothAllIn(newState);

    if (eitherAllIn) {
      // No more action possible — freeze for runout at round end.
      handUpdate.status = 'awaiting_runout';
      handUpdate.actionOnUserId = null;
    } else {
      const next = nextStreet(hand.street as Street);
      if (next === 'showdown') {
        const dealt = dealFromSeed(hand.deckSeed);
        const board = boardForStreet(dealt, 'river');

        const showdownResult = resolveShowdown(
          hand.userAHole as Card[], hand.userBHole as Card[], board,
          newState.pot, match.userAId, match.userBId, round.bbUserId,
        );

        handUpdate.status = 'complete';
        handUpdate.street = 'complete';
        handUpdate.terminalReason = 'showdown';
        handUpdate.winnerUserId = showdownResult.winnerUserId;
        handUpdate.actionOnUserId = null;
        handUpdate.board = board;
        handUpdate.completedAt = new Date();

        const aReserved = handUpdate.userAReserved as number;
        const bReserved = handUpdate.userBReserved as number;
        const d = await settleHand(tx, match, aReserved, bReserved, showdownResult.awards);
        handUpdate.resolvedNetForA = d.aDelta;
        handUpdate.resolvedNetForB = d.bDelta;
        handUpdate.userAReserved = 0;
        handUpdate.userBReserved = 0;

        await logEvent(tx, input.userId, 'hand_completed', {
          hand_id: hand.handId, reason: 'showdown', winner: showdownResult.winnerUserId,
        });
      } else {
        const dealt = dealFromSeed(hand.deckSeed);
        const board = boardForStreet(dealt, next);
        handUpdate.street = next;
        handUpdate.board = board;
        handUpdate.actionOnUserId = round.bbUserId;
      }
    }
  } else {
    handUpdate.actionOnUserId = newState.actionOnUserId;
  }

  await tx.update(hands).set(handUpdate).where(eq(hands.handId, hand.handId));
  return true;
}

/**
 * After applying action(s), recompute round-level turn state: insert at
 * most ONE turn-handoff row (→ exactly one push per turn) and flip the
 * round to 'revealing' when both players are done. Reads the hands table
 * fresh, so it reflects mutations already written in this transaction.
 */
async function recomputeTurnState(
  tx: Transaction,
  round: RoundRow,
  userId: string,
  opponentId: string,
  match: MatchRow,
  notif: PendingNotifState,
): Promise<void> {
  const allHands = await tx.query.hands.findMany({ where: eq(hands.roundId, round.roundId) });
  const myPending = allHands.filter(h => h.status === 'in_progress' && h.actionOnUserId === userId).length;
  const oppPending = allHands.filter(h => h.status === 'in_progress' && h.actionOnUserId === opponentId).length;

  if (myPending === 0 && oppPending > 0) {
    const [handoff] = await tx.insert(turnHandoffs).values({
      roundId: round.roundId,
      fromUserId: userId,
      toUserId: opponentId,
    }).returning();

    notif.handoffs.push({
      handoffId: handoff.handoffId,
      toUserId: opponentId,
      roundId: round.roundId,
      handsPending: oppPending,
      fromUserId: userId,
      matchId: match.matchId,
    });

    await logEvent(tx, userId, 'turn_submitted', { round_id: round.roundId, to_user_id: opponentId });
  }

  if (myPending === 0 && oppPending === 0 && round.status !== 'revealing') {
    // Both done — round is ready to reveal. The client shows the summary
    // and taps "Next round" to advance (spec §10). No push fires here:
    // spec §16 is one-push-per-turn-handoff only (beta feedback S7-5).
    await tx.update(rounds).set({ status: 'revealing' }).where(eq(rounds.roundId, round.roundId));
  }
}

/** Post-commit: fire one push per handoff. Never fires inside a tx. */
async function fireNotifications(db: Database, notif: PendingNotifState) {
  for (const h of notif.handoffs) {
    await dispatch(db, {
      kind: 'turn_handoff',
      toUserId: h.toUserId,
      fromUserId: h.fromUserId,
      matchId: h.matchId,
      roundId: h.roundId,
      handsPending: h.handsPending,
      dedupeKey: `handoff:${h.handoffId}`,
    });
    await enqueueReminder(db, 'turn_handoff', h.toUserId, h.matchId, h.roundId, {
      fromUserId: h.fromUserId,
      handsPending: h.handsPending,
    });
  }
}

// ── Public entry points ────────────────────────────────────────────────────────

/**
 * Apply a single action to a hand. Runs in a transaction with SELECT FOR
 * UPDATE on the match.
 */
export async function applyAction(db: Database, input: ApplyActionInput) {
  const notif: PendingNotifState = { handoffs: [] };

  const result = await db.transaction(async (tx) => {
    const hand = await tx.query.hands.findFirst({ where: eq(hands.handId, input.handId) });
    if (!hand) throw new Error(`Hand ${input.handId} not found`);

    const round = await tx.query.rounds.findFirst({ where: eq(rounds.roundId, hand.roundId) });
    if (!round) throw new Error('Round not found');

    await tx.execute(sql`SELECT * FROM matches WHERE match_id = ${round.matchId} FOR UPDATE`);
    const match = await tx.query.matches.findFirst({ where: eq(matches.matchId, round.matchId) });
    if (!match) throw new Error('Match not found');

    const opponentId = match.userAId === input.userId ? match.userBId : match.userAId;

    const applied = await applyOneActionTx(tx, hand, match, round, {
      userId: input.userId,
      actionType: input.actionType,
      amount: input.amount,
      clientTxId: input.clientTxId,
      clientSentAt: input.clientSentAt,
    });
    if (!applied) {
      // Idempotent replay — return current state without re-firing handoffs.
      return getMatchState(tx, match.matchId, input.userId);
    }

    await recomputeTurnState(tx, round, input.userId, opponentId, match, notif);
    await assertLedgerInvariant(tx, match.matchId);
    return getMatchState(tx, match.matchId, input.userId);
  });

  await fireNotifications(db, notif);
  return result;
}

export interface TurnSubmitInput {
  roundId?: string;
  turnTxId?: string;
  actions: { handId: string; actionType: ActionType; amount: number; clientTxId: string }[];
}

/**
 * Submit a whole turn as one batch of per-hand actions (the "cart", spec
 * §6). Applies every action in order inside ONE transaction against the
 * shared stack — each action's legality is checked against the running
 * available balance, so the batch cannot over-commit total_chips.
 * All-or-nothing: any illegal action throws GameRuleError, rolling the
 * whole turn back (nothing is applied) so the client can return the
 * player to the cart. Idempotent via per-action client_tx_id.
 */
export async function applyTurnBatch(db: Database, userId: string, input: TurnSubmitInput) {
  if (input.actions.length === 0) throw new GameRuleError('No actions in turn submission');

  const notif: PendingNotifState = { handoffs: [] };

  const result = await db.transaction(async (tx) => {
    const firstHand = await tx.query.hands.findFirst({ where: eq(hands.handId, input.actions[0].handId) });
    if (!firstHand) throw new GameRuleError('Hand not found');

    const round = await tx.query.rounds.findFirst({ where: eq(rounds.roundId, firstHand.roundId) });
    if (!round) throw new Error('Round not found');
    if (input.roundId && input.roundId !== round.roundId) {
      throw new GameRuleError('Actions do not belong to the given round');
    }

    await tx.execute(sql`SELECT * FROM matches WHERE match_id = ${round.matchId} FOR UPDATE`);
    const match = await tx.query.matches.findFirst({ where: eq(matches.matchId, round.matchId) });
    if (!match) throw new Error('Match not found');

    const opponentId = match.userAId === userId ? match.userBId : match.userAId;

    let anyApplied = false;
    for (const a of input.actions) {
      const hand = await tx.query.hands.findFirst({ where: eq(hands.handId, a.handId) });
      if (!hand) throw new GameRuleError('Hand not found in this round');
      if (hand.roundId !== round.roundId) throw new GameRuleError('All actions must belong to the same round');

      const applied = await applyOneActionTx(tx, hand, match, round, {
        userId,
        actionType: a.actionType,
        amount: a.amount,
        clientTxId: a.clientTxId,
      });
      anyApplied = anyApplied || applied;
    }

    if (!anyApplied) {
      return getMatchState(tx, match.matchId, userId);
    }

    await recomputeTurnState(tx, round, userId, opponentId, match, notif);
    await assertLedgerInvariant(tx, match.matchId);
    return getMatchState(tx, match.matchId, userId);
  });

  await fireNotifications(db, notif);
  return result;
}

/**
 * Get legal actions for a hand from the requesting user's perspective.
 * Uses the SAME reconstruction (`loadBettingState`) the action path uses,
 * so the advertised min-raise always matches what's enforced.
 */
export async function getLegalActions(db: Database, handId: string, userId: string) {
  const hand = await db.query.hands.findFirst({ where: eq(hands.handId, handId) });
  if (!hand) throw new Error(`Hand ${handId} not found`);

  const empty = { actions: [], min_raise: 0, max_bet: 0, call_amount: 0, pot_size: hand.pot };
  if (hand.status !== 'in_progress' || hand.actionOnUserId !== userId) return empty;

  const round = await db.query.rounds.findFirst({ where: eq(rounds.roundId, hand.roundId) });
  if (!round) throw new Error('Round not found');
  const match = await db.query.matches.findFirst({ where: eq(matches.matchId, round.matchId) });
  if (!match) throw new Error('Match not found');

  const state = await loadBettingState(db, hand, match, round, userId);
  const legal = engineLegalActions(state);
  const myAvailable = state.players.find(p => p.userId === userId)!.available;

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

/**
 * Lenient batch apply used by the auto-act path (auto check/fold the
 * remaining hands when a player has 0 available). Unlike `applyTurnBatch`,
 * this SKIPS actions that are no longer valid rather than failing the
 * whole batch — auto-act must be resilient to hands that already resolved.
 */
export async function applyBatchActions(
  db: Database,
  userId: string,
  batchActions: { handId: string; actionType: ActionType; amount: number; clientTxId: string }[],
) {
  if (batchActions.length === 0) return null;

  const notif: PendingNotifState = { handoffs: [] };

  const result = await db.transaction(async (tx) => {
    const firstHand = await tx.query.hands.findFirst({ where: eq(hands.handId, batchActions[0].handId) });
    if (!firstHand) throw new Error('Hand not found');

    const round = await tx.query.rounds.findFirst({ where: eq(rounds.roundId, firstHand.roundId) });
    if (!round) throw new Error('Round not found');

    await tx.execute(sql`SELECT 1 FROM matches WHERE match_id = ${round.matchId} FOR UPDATE`);
    const match = await tx.query.matches.findFirst({ where: eq(matches.matchId, round.matchId) });
    if (!match) throw new Error('Match not found');

    const isUserA = match.userAId === userId;
    const opponentId = isUserA ? match.userBId : match.userAId;

    for (const action of batchActions) {
      const existing = await tx.query.actions.findFirst({
        where: and(eq(actions.handId, action.handId), eq(actions.clientTxId, action.clientTxId)),
      });
      if (existing) continue;

      const hand = await tx.query.hands.findFirst({ where: eq(hands.handId, action.handId) });
      if (!hand || hand.status !== 'in_progress' || hand.actionOnUserId !== userId) continue;

      if (action.actionType === 'fold') {
        const winnerId = opponentId;
        const aReserved = hand.userAReserved;
        const bReserved = hand.userBReserved;
        const d = await settleHand(tx, match, aReserved, bReserved, [{ userId: winnerId, amount: hand.pot }]);

        await tx.insert(actions).values({
          handId: hand.handId,
          street: hand.street,
          actingUserId: userId,
          actionType: 'fold',
          amount: 0,
          potAfter: hand.pot,
          clientTxId: action.clientTxId,
        });

        await tx.update(hands).set({
          status: 'complete',
          street: 'complete',
          terminalReason: 'fold',
          foldStreet: hand.street as 'preflop' | 'flop' | 'turn' | 'river',
          winnerUserId: winnerId,
          actionOnUserId: null,
          completedAt: new Date(),
          userAReserved: 0,
          userBReserved: 0,
          resolvedNetForA: d.aDelta,
          resolvedNetForB: d.bDelta,
        }).where(eq(hands.handId, hand.handId));
      } else if (action.actionType === 'check') {
        await tx.insert(actions).values({
          handId: hand.handId,
          street: hand.street,
          actingUserId: userId,
          actionType: 'check',
          amount: 0,
          potAfter: hand.pot,
          clientTxId: action.clientTxId,
        });
        await tx.update(hands).set({ actionOnUserId: opponentId }).where(eq(hands.handId, hand.handId));
      }
    }

    await recomputeTurnState(tx, round, userId, opponentId, match, notif);
    await assertLedgerInvariant(tx, match.matchId);
    return getMatchState(tx, match.matchId, userId);
  });

  await fireNotifications(db, notif);
  return result;
}

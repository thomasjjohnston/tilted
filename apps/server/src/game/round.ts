import { eq, and, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/connection.js';
import { matches, rounds, hands } from '../db/schema.js';
import { HANDS_PER_ROUND, BLIND_SMALL, BLIND_BIG, MIN_CHIPS_FOR_ROUND } from './constants.js';
import { generateSeed, dealFromSeed } from '../engine/deck.js';
import { endMatch, getMatchState } from './match.js';
import { assertLedgerInvariant } from './ledger.js';
import { resolveShowdown } from '../engine/showdown.js';
import { boardForStreet, dealFromSeed as deal } from '../engine/deck.js';
import type { Card } from '../engine/types.js';
import { logEvent } from '../events/logger.js';
import { dispatch } from '../notif/dispatchers.js';

/**
 * Open a new round: deal 10 hands, post blinds, set action_on to SB.
 * Called inside a transaction.
 */
export async function openRound(
  tx: Transaction,
  matchId: string,
  roundIndex: number,
): Promise<string> {
  const match = await tx.query.matches.findFirst({
    where: eq(matches.matchId, matchId),
  });
  if (!match) throw new Error(`Match ${matchId} not found`);

  // Determine SB for this round (flips each round)
  // Round 1: sbOfRound1. Round 2: the other player. Round 3: sbOfRound1 again. etc.
  const isOddRound = roundIndex % 2 === 1;
  const sbUserId = isOddRound ? match.sbOfRound1 : (
    match.sbOfRound1 === match.userAId ? match.userBId : match.userAId
  );
  const bbUserId = sbUserId === match.userAId ? match.userBId : match.userAId;

  // Create round
  const [round] = await tx.insert(rounds).values({
    matchId,
    roundIndex,
    sbUserId,
    bbUserId,
    status: 'in_progress',
  }).returning();

  // Post blinds atomically for all 10 hands
  const totalSbBlinds = HANDS_PER_ROUND * BLIND_SMALL;
  const totalBbBlinds = HANDS_PER_ROUND * BLIND_BIG;

  // Deal 10 hands
  for (let i = 0; i < HANDS_PER_ROUND; i++) {
    const seed = generateSeed();
    const dealt = dealFromSeed(seed);

    // Map SB/BB to user A/B
    const isUserASb = sbUserId === match.userAId;
    const userAHole = isUserASb ? dealt.userAHole : dealt.userBHole;
    const userBHole = isUserASb ? dealt.userBHole : dealt.userAHole;
    // Note: "userA" in the deal is always SB, "userB" is BB
    // But in the DB, userA/userB is the match-level assignment
    // SB's hole cards go to whichever user is SB
    const userAReserved = isUserASb ? BLIND_SMALL : BLIND_BIG;
    const userBReserved = isUserASb ? BLIND_BIG : BLIND_SMALL;

    await tx.insert(hands).values({
      roundId: round.roundId,
      handIndex: i,
      deckSeed: seed,
      userAHole: isUserASb ? dealt.userAHole : dealt.userBHole,
      userBHole: isUserASb ? dealt.userBHole : dealt.userAHole,
      board: [],
      pot: BLIND_SMALL + BLIND_BIG,
      userAReserved,
      userBReserved,
      street: 'preflop',
      actionOnUserId: sbUserId, // Preflop: SB acts first in HU
      status: 'in_progress',
    });
  }

  // Deduct blinds from match totals: no — blinds are reserved, not lost.
  // The total_chips doesn't change when blinds are posted; only reserved increases.
  // But we track reserved per-hand, so totals stay the same.
  // The available is computed as total - Σ reserved.

  await assertLedgerInvariant(tx, matchId);

  return round.roundId;
}

/**
 * Advance to the next round after reveal.
 * Called when client taps "Next round".
 */
export async function advanceRound(
  db: Database,
  roundId: string,
  userId: string,
) {
  let matchEndedInfo: { matchId: string; winnerUserId: string; loserUserId: string } | null = null;

  const result = await db.transaction(async (tx) => {
    // Lock the match
    const round = await tx.query.rounds.findFirst({
      where: eq(rounds.roundId, roundId),
    });
    if (!round) throw new Error(`Round ${roundId} not found`);

    // Lock the match row
    await tx.execute(sql`SELECT 1 FROM matches WHERE match_id = ${round.matchId} FOR UPDATE`);
    const m = await tx.query.matches.findFirst({
      where: eq(matches.matchId, round.matchId),
    });
    if (!m) throw new Error(`Match not found`);

    // If round is already complete and next round exists, return current state
    if (round.status === 'complete') {
      // Check if there's already a next round
      const nextRound = await tx.query.rounds.findFirst({
        where: and(
          eq(rounds.matchId, round.matchId),
          eq(rounds.roundIndex, round.roundIndex + 1),
        ),
      });
      if (nextRound) {
        return getMatchState(tx, round.matchId, userId);
      }
    }

    // If round is in 'revealing' state, process it
    if (round.status === 'revealing') {
      // Deal remaining cards for awaiting_runout hands
      const roundHands = await tx.query.hands.findMany({
        where: eq(hands.roundId, roundId),
      });

      for (const h of roundHands) {
        if (h.status === 'awaiting_runout') {
          // Deal remaining board cards
          const dealt = dealFromSeed(h.deckSeed);
          const fullBoard = [...dealt.flop, dealt.turn, dealt.river];

          // Determine hole cards based on SB/BB mapping
          const userAHole = h.userAHole as Card[];
          const userBHole = h.userBHole as Card[];

          // Resolve showdown
          const result = resolveShowdown(
            userAHole,
            userBHole,
            fullBoard as Card[],
            h.pot,
            m.userAId,
            m.userBId,
            round.bbUserId,
          );

          // Update hand
          await tx.update(hands)
            .set({
              board: fullBoard,
              status: 'complete',
              street: 'complete',
              terminalReason: 'showdown',
              winnerUserId: result.winnerUserId,
              completedAt: new Date(),
            })
            .where(eq(hands.handId, h.handId));

          // Settle chips: new_total = old_total - reserved + award (0 for loser)
          const aAward = result.awards.find(a => a.userId === m.userAId)?.amount ?? 0;
          const bAward = result.awards.find(a => a.userId === m.userBId)?.amount ?? 0;
          await tx.update(matches).set({
            userATotal: sql`${matches.userATotal} + ${aAward - h.userAReserved}`,
            userBTotal: sql`${matches.userBTotal} + ${bAward - h.userBReserved}`,
          }).where(eq(matches.matchId, m.matchId));
        }
      }

      // Mark round complete
      await tx.update(rounds).set({
        status: 'complete',
        completedAt: new Date(),
      }).where(eq(rounds.roundId, roundId));

      await logEvent(tx, userId, 'round_completed', { round_id: roundId });
    }

    // Check bust condition: refresh match data
    const updatedMatch = await tx.query.matches.findFirst({
      where: eq(matches.matchId, round.matchId),
    });
    if (!updatedMatch) throw new Error('Match not found after update');

    // Bust check: if either player has less than MIN_CHIPS_FOR_ROUND
    if (updatedMatch.userATotal < MIN_CHIPS_FOR_ROUND || updatedMatch.userBTotal < MIN_CHIPS_FOR_ROUND) {
      const winner = updatedMatch.userATotal >= updatedMatch.userBTotal
        ? updatedMatch.userAId : updatedMatch.userBId;
      const loser = winner === updatedMatch.userAId ? updatedMatch.userBId : updatedMatch.userAId;
      await endMatch(tx, updatedMatch.matchId, winner);
      await logEvent(tx, userId, 'match_ended', {
        match_id: updatedMatch.matchId,
        winner_user_id: winner,
      });
      matchEndedInfo = { matchId: updatedMatch.matchId, winnerUserId: winner, loserUserId: loser };
      return getMatchState(tx, updatedMatch.matchId, userId);
    }

    // Open next round
    const nextRoundIndex = round.roundIndex + 1;
    await openRound(tx, round.matchId, nextRoundIndex);

    return getMatchState(tx, round.matchId, userId);
  });

  // Post-commit: on match end, tell both players.
  if (matchEndedInfo !== null) {
    const info = matchEndedInfo as { matchId: string; winnerUserId: string; loserUserId: string };
    for (const toUserId of [info.winnerUserId, info.loserUserId]) {
      const fromUserId = toUserId === info.winnerUserId ? info.loserUserId : info.winnerUserId;
      await dispatch(db, {
        kind: 'match_ended',
        toUserId,
        fromUserId,
        matchId: info.matchId,
        winnerUserId: info.winnerUserId,
        dedupeKey: `match-ended:${info.matchId}:${toUserId}`,
      });
    }
  }

  return result;
}

import { evaluate, compareHands } from './evaluator.js';
import type { Card, BettingState } from './types.js';

export interface ShowdownResult {
  winnerUserId: string | null; // null = split pot
  /** Chips awarded to each player. In split pot, each gets half (odd chip to OOP). */
  awards: { userId: string; amount: number }[];
  handRankA: ReturnType<typeof evaluate>;
  handRankB: ReturnType<typeof evaluate>;
}

/**
 * Resolve a showdown between two players.
 * Per spec §17: odd chip goes to out-of-position player (BB in HU).
 */
export function resolveShowdown(
  userAHole: Card[],
  userBHole: Card[],
  board: Card[],
  pot: number,
  userAId: string,
  userBId: string,
  bbUserId: string,
): ShowdownResult {
  const rankA = evaluate(userAHole, board);
  const rankB = evaluate(userBHole, board);
  const cmp = compareHands(rankA, rankB);

  if (cmp > 0) {
    // Player A wins
    return {
      winnerUserId: userAId,
      awards: [{ userId: userAId, amount: pot }],
      handRankA: rankA,
      handRankB: rankB,
    };
  }

  if (cmp < 0) {
    // Player B wins
    return {
      winnerUserId: userBId,
      awards: [{ userId: userBId, amount: pot }],
      handRankA: rankA,
      handRankB: rankB,
    };
  }

  // Split pot — odd chip to OOP player (BB in HU)
  const half = Math.floor(pot / 2);
  const remainder = pot % 2;
  const oopId = bbUserId;
  const ipId = userAId === bbUserId ? userBId : userAId;

  return {
    winnerUserId: null,
    awards: [
      { userId: oopId, amount: half + remainder },
      { userId: ipId, amount: half },
    ],
    handRankA: rankA,
    handRankB: rankB,
  };
}

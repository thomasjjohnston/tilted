// Fast 7-card evaluator for the solver's E[HS] Monte Carlo.
//
// The server's existing evaluator (src/engine/evaluator.ts) is best-5-of-21
// with readable output — perfect for showdowns, far too slow for the ~10k
// evaluations behind a single bucket assignment. This is a port of the
// solver pipeline's evaluator (same u32 score layout as the Rust kernel and
// tools/solver/tilted_solver/eval7.py); differential-tested against the
// server evaluator in test/engine/solver-bucketing.test.ts.
//
// Card ints here use the SOLVER convention: card = rank*4 + suit,
// rank 0 = deuce .. 12 = ace, suits in (c, d, h, s) order — NOT the server's
// Card string type. Convert at the boundary with cardToInt().

import type { Card } from '../types.js';

const SOLVER_SUITS = 'cdhs';
const SOLVER_RANKS = '23456789TJQKA';

/** Server "Ah" → solver int. */
export function cardToInt(card: Card): number {
  const rank = SOLVER_RANKS.indexOf(card[0]);
  const suit = SOLVER_SUITS.indexOf(card[1]);
  if (rank < 0 || suit < 0) throw new Error(`bad card: ${card}`);
  return rank * 4 + suit;
}

function straightHigh(mask: number): number | null {
  const m = ((mask & 0x1000) >> 12) | (mask << 1);
  let run = 0;
  let best: number | null = null;
  for (let r = 0; r < 14; r++) {
    if ((m >> r) & 1) {
      run += 1;
      if (run >= 5) best = r - 1;
    } else {
      run = 0;
    }
  }
  return best;
}

function pack(ranks: number[]): number {
  let v = 0;
  for (const r of ranks) v = v * 16 + r;
  return v * Math.pow(16, 5 - ranks.length);
}

/** Seven solver-convention card ints → comparable score (higher wins). */
export function eval7(cards: number[]): number {
  const rankCounts = new Array<number>(13).fill(0);
  const suitCounts = [0, 0, 0, 0];
  const suitMasks = [0, 0, 0, 0];
  let rankMask = 0;
  for (const c of cards) {
    const r = c >> 2;
    const s = c & 3;
    rankCounts[r] += 1;
    suitCounts[s] += 1;
    suitMasks[s] |= 1 << r;
    rankMask |= 1 << r;
  }

  for (let s = 0; s < 4; s++) {
    if (suitCounts[s] >= 5) {
      const high = straightHigh(suitMasks[s]);
      if (high !== null) return 8 * 0x100000 + pack([high]);
      const ranks: number[] = [];
      for (let r = 12; r >= 0 && ranks.length < 5; r--) {
        if ((suitMasks[s] >> r) & 1) ranks.push(r);
      }
      return 5 * 0x100000 + pack(ranks);
    }
  }

  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    switch (rankCounts[r]) {
      case 4: quads.push(r); break;
      case 3: trips.push(r); break;
      case 2: pairs.push(r); break;
      case 1: singles.push(r); break;
    }
  }

  if (quads.length > 0) {
    const q = quads[0];
    let kicker = -1;
    for (let r = 12; r >= 0; r--) {
      if (r !== q && rankCounts[r] > 0) { kicker = r; break; }
    }
    return 7 * 0x100000 + pack([q, kicker]);
  }

  if (trips.length > 0 && (trips.length >= 2 || pairs.length > 0)) {
    const t = trips[0];
    const p = trips.length >= 2 && pairs.length > 0
      ? Math.max(trips[1], pairs[0])
      : trips.length >= 2 ? trips[1] : pairs[0];
    return 6 * 0x100000 + pack([t, p]);
  }

  const high = straightHigh(rankMask);
  if (high !== null) return 4 * 0x100000 + pack([high]);

  if (trips.length > 0) return 3 * 0x100000 + pack([trips[0], ...singles.slice(0, 2)]);

  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    let kicker = -1;
    for (let r = 12; r >= 0; r--) {
      if (r !== p1 && r !== p2 && rankCounts[r] > 0) { kicker = r; break; }
    }
    return 2 * 0x100000 + pack([p1, p2, kicker]);
  }

  if (pairs.length === 1) return 1 * 0x100000 + pack([pairs[0], ...singles.slice(0, 3)]);

  return pack(singles.slice(0, 5));
}

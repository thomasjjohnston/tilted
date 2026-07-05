// E[HS] bucket assignment: which strength bucket does a concrete hand fall
// into on a concrete board? Mirrors tools/solver bucketing semantics.
//
// Deliberate deviation, documented: the training pipeline seeds its E[HS]
// Monte Carlo with a Rust-specific hash+ChaCha8; porting that bit-exactly
// buys nothing — bucket assignments already carry Monte Carlo noise, and
// adjacent percentile buckets hold near-identical strategies. We use our own
// deterministic PRNG (seeded from the cards), so repeated queries for the
// same hand are stable, and land within MC noise of the Python/Rust bucket.
// Bounds on that noise are pinned by fixtures in solver-bucketing.test.ts.

import type { Card } from '../types.js';
import { cardToInt, eval7 } from './eval7.js';

/** splitmix32 — tiny, deterministic, plenty for MC sampling. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = (t ^ (t >>> 15)) >>> 0;
    return t / 4294967296;
  };
}

function seedFromCards(cards: number[]): number {
  let h = 0x811c9dc5;
  for (const c of cards) {
    h ^= c + 1;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Expected hand strength vs a uniform random opponent over uniform runouts:
 * P(win) + P(tie)/2. Deterministic for a given (hole, board).
 */
export function expectedHandStrength(hole: [Card, Card], board: Card[], samples: number): number {
  const holeInts = [cardToInt(hole[0]), cardToInt(hole[1])];
  const boardInts = board.map(cardToInt);
  const dead = new Set([...holeInts, ...boardInts]);
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);

  const need = 5 - boardInts.length;
  const rng = makeRng(seedFromCards([...holeInts, ...boardInts]));
  const my7 = [...holeInts, ...boardInts];
  const opp7 = [...boardInts];
  let total = 0;

  const draw = [...deck];
  for (let s = 0; s < samples; s++) {
    // Partial Fisher-Yates: need runout cards + 2 opponent cards.
    for (let i = 0; i < need + 2; i++) {
      const j = i + Math.floor(rng() * (draw.length - i));
      const tmp = draw[i];
      draw[i] = draw[j];
      draw[j] = tmp;
    }
    const runout = draw.slice(0, need);
    const me = eval7([...my7, ...runout]);
    const opp = eval7([...opp7, ...runout, draw[need], draw[need + 1]]);
    if (me > opp) total += 1;
    else if (me === opp) total += 0.5;
  }
  return total / samples;
}

/**
 * Bucket index for a hand: preflop uses the exact 169 classes; postflop
 * counts boundaries below the hand's E[HS] (same partition semantics as the
 * Rust/Python sides).
 */
export function assignBucket(
  street: number,
  hole: [Card, Card],
  board: Card[],
  boundaries: { flop: number[]; turn: number[]; river: number[]; ehs_samples: number },
): number {
  if (street === 0) return preflopClass(hole[0], hole[1]);
  const ehs = expectedHandStrength(hole, board, boundaries.ehs_samples);
  const bounds = street === 1 ? boundaries.flop : street === 2 ? boundaries.turn : boundaries.river;
  let lo = 0;
  let hi = bounds.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bounds[mid] < ehs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The 169 preflop classes — must match tools/solver cards.py exactly. */
export function preflopClass(c1: Card, c2: Card): number {
  const a = cardToInt(c1);
  const b = cardToInt(c2);
  const r1 = a >> 2;
  const r2 = b >> 2;
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  if (r1 === r2) return hi * 13 + lo;
  if ((a & 3) === (b & 3)) return hi * 13 + lo; // suited
  return lo * 13 + hi; // offsuit
}

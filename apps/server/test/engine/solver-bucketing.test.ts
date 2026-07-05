// eval7 + E[HS] bucketing tests.
//
// Parity with the training pipeline is statistical by design (different PRNG,
// same sampling process — see bucketing.ts header). Exact where it can be:
// preflop classes, partition semantics, determinism, hand categories.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareHands, evaluate } from '../../src/engine/evaluator.js';
import type { Card } from '../../src/engine/types.js';
import { cardToInt, eval7 } from '../../src/engine/solver/eval7.js';
import {
  assignBucket,
  expectedHandStrength,
  preflopClass,
} from '../../src/engine/solver/bucketing.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, 'fixtures', 'solver-bucketing.json'), 'utf-8'),
) as {
  buckets: { flop: number[]; turn: number[]; river: number[]; ehs_samples: number };
  n_buckets: { flop: number; turn: number; river: number };
  postflop: Array<{ street: number; hole: string; board: string; bucket: number }>;
  preflop: Array<{ hole: string; class: number }>;
};

const cards = (s: string) => s.split(/\s+/) as Card[];

describe('solver eval7', () => {
  it('scores known hand categories', () => {
    const cases: Array<[string, number]> = [
      ['Ah Kh Qh Jh Th 2c 3d', 8],
      ['5h 4h 3h 2h Ah 9c 9d', 8],
      ['9c 9d 9h 9s Kd 2c 3c', 7],
      ['9c 9d 9h Ks Kd 2c 3c', 6],
      ['Ah 9h 7h 4h 2h Kc Qd', 5],
      ['9c 8d 7h 6s 5d Ac Kd', 4],
      ['5h 4d 3c 2s Ad Kc 9h', 4],
      ['9c 9d 9h Ks Qd 2c 3c', 3],
      ['9c 9d Kh Ks Qd 2c 3c', 2],
      ['9c 9d Kh Qs Jd 2c 3c', 1],
      ['Ac Kd 9h 7s 5d 3c 2h', 0],
    ];
    for (const [hand, category] of cases) {
      expect(Math.floor(eval7(cards(hand).map(cardToInt)) / 0x100000), hand).toBe(category);
    }
  });

  it('orders hands identically to the server evaluator on random 7-card matchups', () => {
    // Two independent implementations; ordering must agree. Deterministic
    // sweep over structured deals rather than RNG for reproducibility.
    const deck: Card[] = [];
    for (const r of '23456789TJQKA') for (const s of 'hdcs') deck.push(`${r}${s}` as Card);
    let compared = 0;
    for (let offset = 0; offset < 60; offset++) {
      const seen = new Set<Card>();
      const fourteen: Card[] = [];
      for (let i = 0; fourteen.length < 14 && i < 200; i++) {
        const c = deck[(i * 7 + offset * 11 + Math.floor(i / 8)) % 52];
        if (!seen.has(c)) {
          seen.add(c);
          fourteen.push(c);
        }
      }
      if (fourteen.length < 14) continue;
      // Shared board of 5, two 2-card holes + 2 spares ignored.
      const board = fourteen.slice(0, 5);
      const a = [...fourteen.slice(5, 7), ...board];
      const b = [...fourteen.slice(7, 9), ...board];
      const fast = Math.sign(eval7(a.map(cardToInt)) - eval7(b.map(cardToInt)));
      const ref = Math.sign(compareHands(
        evaluate(fourteen.slice(5, 7), board),
        evaluate(fourteen.slice(7, 9), board),
      ));
      expect(fast, `${a.join(' ')} vs ${b.join(' ')}`).toBe(ref);
      compared++;
    }
    expect(compared).toBeGreaterThan(40);
  });
});

describe('solver bucketing', () => {
  it('preflop classes match the training pipeline exactly', () => {
    for (const c of fixtures.preflop) {
      const [c1, c2] = cards(c.hole);
      expect(preflopClass(c1, c2), c.hole).toBe(c.class);
    }
  });

  it('is deterministic for repeated queries', () => {
    const b1 = assignBucket(1, ['Ah', 'Kh'], cards('Qh Jh Th'), fixtures.buckets);
    const b2 = assignBucket(1, ['Ah', 'Kh'], cards('Qh Jh Th'), fixtures.buckets);
    expect(b1).toBe(b2);
  });

  it('separates nut hands from trash', () => {
    const royal = assignBucket(1, ['Ah', 'Kh'], cards('Qh Jh Th'), fixtures.buckets);
    const trash = assignBucket(1, ['7c', '2d'], cards('Qh Jh Th'), fixtures.buckets);
    expect(royal).toBeGreaterThan(fixtures.n_buckets.flop * 0.9);
    expect(trash).toBeLessThan(royal);
    const nutRiver = expectedHandStrength(['Ah', 'Kh'], cards('Qh Jh Th 2c 3d'), 200);
    expect(nutRiver).toBe(1.0);
  });

  it('lands within Monte Carlo noise of the training-side bucket on every fixture', () => {
    // Different PRNGs, same process: EHS estimates differ by sampling error
    // (sigma ~ 0.04 at 128 samples per side). Buckets are percentile-dense,
    // so allow a wide index band; systematic bias would blow through it.
    let totalDrift = 0;
    for (const c of fixtures.postflop) {
      const [c1, c2] = cards(c.hole);
      const bucket = assignBucket(c.street, [c1, c2], cards(c.board), fixtures.buckets);
      const nb = c.street === 1 ? fixtures.n_buckets.flop
        : c.street === 2 ? fixtures.n_buckets.turn : fixtures.n_buckets.river;
      const drift = Math.abs(bucket - c.bucket);
      expect(drift, `${c.hole} on ${c.board}`).toBeLessThanOrEqual(nb * 0.25);
      totalDrift += drift / nb;
    }
    // Mean drift should be far tighter than the per-case bound.
    expect(totalDrift / fixtures.postflop.length).toBeLessThan(0.08);
  });
});

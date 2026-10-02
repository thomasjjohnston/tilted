// Cross-language conformance: the TS solver engine must reproduce the Python
// reference (itself pinned to the Rust trainer) on every generated vector.
// Regenerate fixtures with:
//   cd tools/solver && uv run python -m tilted_solver.genvectors \
//     configs/best.json ../../apps/server/test/engine/fixtures/solver-conformance.json

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_TOKENS,
  SolverBetState,
  type SolverConfig,
} from '../../src/engine/solver/betting.js';
import { translateHand, type RealAction } from '../../src/engine/solver/mapper.js';

interface Vectors {
  config: SolverConfig;
  playouts: Array<{
    depth_bb: number;
    steps: Array<{
      legal: Array<{ token: string; to: number }>;
      choose: number;
      street: number;
      pot: number;
      to_act: number;
    }>;
    final: {
      seq: string;
      terminal: string;
      committed: [number, number];
      pot: number;
      street: number;
    };
  }>;
  translations: Array<{
    depth_bb: number;
    real_actions: Array<{ player: number; kind: string; to?: number }>;
    expect: {
      seq: string;
      street: number;
      to_act: number;
      pot: number;
      translation: string[];
    };
  }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const vectors: Vectors = JSON.parse(
  readFileSync(join(here, 'fixtures', 'solver-conformance.json'), 'utf-8'),
);

describe('solver betting engine conformance', () => {
  it('replays every playout vector with identical legal actions and finals', () => {
    expect(vectors.playouts.length).toBeGreaterThan(300);
    for (const [pi, playout] of vectors.playouts.entries()) {
      const state = new SolverBetState(vectors.config, playout.depth_bb);
      for (const [si, step] of playout.steps.entries()) {
        const ctx = `playout ${pi} (${playout.depth_bb}bb) step ${si}`;
        expect(state.terminal, ctx).toBeNull();
        expect(state.street, ctx).toBe(step.street);
        expect(state.pot(), ctx).toBe(step.pot);
        expect(state.toAct, ctx).toBe(step.to_act);
        const legal = state.legalActions().map(a => ({ token: a.token, to: a.to }));
        expect(legal, ctx).toEqual(step.legal);
        state.apply(state.legalActions()[step.choose]);
      }
      const ctx = `playout ${pi} final`;
      expect(state.seqStr(), ctx).toBe(playout.final.seq);
      expect(state.terminal, ctx).toBe(playout.final.terminal);
      expect([...state.committed], ctx).toEqual(playout.final.committed);
      expect(state.pot(), ctx).toBe(playout.final.pot);
      expect(state.street, ctx).toBe(playout.final.street);
    }
  });

  it('translates every real-action vector to the expected abstract spot', () => {
    expect(vectors.translations.length).toBeGreaterThan(100);
    for (const [ti, t] of vectors.translations.entries()) {
      const spot = translateHand(vectors.config, t.depth_bb, t.real_actions as RealAction[]);
      const ctx = `translation ${ti} (${t.depth_bb}bb)`;
      expect(spot.seq, ctx).toBe(t.expect.seq);
      expect(spot.street, ctx).toBe(t.expect.street);
      expect(spot.state.toAct, ctx).toBe(t.expect.to_act);
      expect(spot.state.pot(), ctx).toBe(t.expect.pot);
      expect(spot.translation, ctx).toEqual(t.expect.translation);
    }
  });
});

describe('solver betting engine properties', () => {
  it('conserves chips and terminates on random playouts at every depth', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(10, 25, 60, 100, 150, 200),
        fc.array(fc.nat({ max: 7 }), { minLength: 40, maxLength: 40 }),
        (depth, picks) => {
          const state = new SolverBetState(vectors.config, depth);
          for (const pick of picks) {
            if (state.terminal !== null) break;
            const legal = state.legalActions();
            expect(legal.length).toBeGreaterThan(0);
            state.apply(legal[pick % legal.length]);
            expect(state.committed[0]).toBeLessThanOrEqual(state.stack);
            expect(state.committed[1]).toBeLessThanOrEqual(state.stack);
            expect(state.seq.length).toBeLessThanOrEqual(MAX_TOKENS);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

// Solver strategy storage: reader semantics against real Postgres.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { solverMeta, solverStrategies } from '../../src/db/schema.js';
import {
  getSolverMeta,
  lookupStrategy,
  nearestDepth,
} from '../../src/game/solver-strategies.js';
import { freshDb, type TestEnv } from './helpers.js';

describe('solver strategy storage', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await freshDb();
    await env.db.insert(solverMeta).values([
      { key: 'config', value: { blind_small: 5, blind_big: 10, bet_menus: {} } },
      { key: 'buckets', value: { flop: [0.5], turn: [0.5], river: [0.5], ehs_samples: 128 } },
      { key: 'depths', value: [10, 25, 60, 100, 150, 200] },
    ]);
    await env.db.insert(solverStrategies).values([
      { depthBb: 200, street: 0, seq: '', bucket: 168, tokens: ['f', 'c', 'r0', 'a'], strategy: [0.01, 0.2, 0.7, 0.09] },
      { depthBb: 200, street: 0, seq: '', bucket: 100, tokens: ['f', 'c', 'r0', 'a'], strategy: [0.5, 0.3, 0.15, 0.05] },
      { depthBb: 200, street: 1, seq: 'r0c/', bucket: 300, tokens: ['c', 'r0', 'a'], strategy: [0.6, 0.35, 0.05] },
    ]);
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('loads meta bundle', async () => {
    const meta = await getSolverMeta(env.db);
    expect(meta).not.toBeNull();
    expect(meta!.depths).toContain(200);
    expect(meta!.config.blind_big).toBe(10);
  });

  it('returns null meta when nothing imported', async () => {
    // cleanup() is a no-op by design (truncation happens in freshDb);
    // empty the tables explicitly for this case.
    await env.db.delete(solverStrategies);
    await env.db.delete(solverMeta);
    expect(await getSolverMeta(env.db)).toBeNull();
  });

  it('exact lookup returns the row', async () => {
    const row = await lookupStrategy(env.db, 200, 0, '', 168);
    expect(row).not.toBeNull();
    expect(row!.bucket).toBe(168);
    expect(row!.tokens).toEqual(['f', 'c', 'r0', 'a']);
    expect(row!.strategy.reduce((a, b) => a + b, 0)).toBeCloseTo(1.0, 5);
  });

  it('falls back to the nearest bucket on the same line', async () => {
    const row = await lookupStrategy(env.db, 200, 0, '', 140);
    expect(row).not.toBeNull();
    expect(row!.bucket).toBe(168); // |168-140| = 28 < |100-140| = 40
  });

  it('returns null for a truly off-book line', async () => {
    expect(await lookupStrategy(env.db, 200, 2, 'cc/cc/', 50)).toBeNull();
    expect(await lookupStrategy(env.db, 150, 0, '', 168)).toBeNull();
  });

  it('nearestDepth snaps effective chips to the grid', () => {
    const depths = [10, 25, 60, 100, 150, 200];
    expect(nearestDepth(depths, 2000, 10)).toBe(200);
    // 173.5bb is nearer 150 than 200 (23.5 vs 26.5) — matches the Python side.
    expect(nearestDepth(depths, 1735, 10)).toBe(150);
    expect(nearestDepth(depths, 1200, 10)).toBe(100);
    expect(nearestDepth(depths, 90, 10)).toBe(10);
  });
});

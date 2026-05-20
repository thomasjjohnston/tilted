// Verifies that the fold settlement writes correct resolved_net values
// to hands.resolved_net_for_a and resolved_net_for_b. The sum should be
// zero (chip ledger invariant), winner positive, loser negative.

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedBaseScenario, skipIfNoDb, type TestEnv } from './helpers.js';
import { applyAction } from '../../src/game/turn.js';
import { hands } from '../../src/db/schema.js';

describe.skipIf(skipIfNoDb)('fold resolved_net snapshot', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  it('sums to zero and assigns the pot delta to the winner on a preflop fold', async () => {
    const s = await seedBaseScenario(env.db);
    // Alice (SB) folds preflop. Bob (BB) wins the 15 pot.
    // Alice's delta: she had 5 reserved (SB blind), award = 0 → -5
    // Bob's delta: had 10 reserved (BB blind), award = 15 → +5
    await applyAction(env.db, {
      handId: s.handId,
      userId: s.alice.userId,
      actionType: 'fold',
      amount: 0,
      clientTxId: 'resolved-net-1',
    });

    const row = await env.db.query.hands.findFirst({ where: eq(hands.handId, s.handId) });
    expect(row!.resolvedNetForA).toBe(-5);
    expect(row!.resolvedNetForB).toBe(5);
    expect((row!.resolvedNetForA ?? 0) + (row!.resolvedNetForB ?? 0)).toBe(0);
  });
});

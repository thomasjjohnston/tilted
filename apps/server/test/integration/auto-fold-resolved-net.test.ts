// Verifies that applyBatchActions (the path iOS uses when auto-folding
// hands at zero available chips) writes resolved_net_for_* correctly.

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  freshDb, seedUser, seedMatch, seedRound, seedHand,
  skipIfNoDb, type TestEnv,
} from './helpers.js';
import { applyBatchActions } from '../../src/game/turn.js';
import { hands } from '../../src/db/schema.js';

describe.skipIf(skipIfNoDb)('applyBatchActions writes resolved_net on fold', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  it('batched preflop folds each write correct -SB / +SB deltas', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
    const round = await seedRound(env.db, match.matchId, {
      sbUserId: alice.userId, bbUserId: bob.userId,
    });
    // Two preflop hands awaiting alice (SB) action. Both have the
    // standard 5/10 blind seeding; alice batch-folds both. Default
    // 2000 starting stacks easily cover the ledger invariant.
    const h1 = await seedHand(env.db, round.roundId, {
      handIndex: 0, actionOnUserId: alice.userId,
    });
    const h2 = await seedHand(env.db, round.roundId, {
      handIndex: 1, actionOnUserId: alice.userId,
    });

    await applyBatchActions(env.db, alice.userId, [
      { handId: h1.handId, actionType: 'fold', amount: 0, clientTxId: 'batch-1' },
      { handId: h2.handId, actionType: 'fold', amount: 0, clientTxId: 'batch-2' },
    ]);

    const r1 = await env.db.query.hands.findFirst({ where: eq(hands.handId, h1.handId) });
    const r2 = await env.db.query.hands.findFirst({ where: eq(hands.handId, h2.handId) });

    expect(r1!.status).toBe('complete');
    expect(r1!.terminalReason).toBe('fold');
    expect(r1!.foldStreet).toBe('preflop');
    expect(r1!.resolvedNetForA).toBe(-5);
    expect(r1!.resolvedNetForB).toBe(5);

    expect(r2!.status).toBe('complete');
    expect(r2!.resolvedNetForA).toBe(-5);
    expect(r2!.resolvedNetForB).toBe(5);
  });
});

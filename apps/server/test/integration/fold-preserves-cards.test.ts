// Verifies the fix for spec §11 hole-card preservation: when a user
// folds, their hole cards stay in the persisted hands row. Opponent
// view-gating happens at the serialization layer (see
// api-redacts-fold-hole.test.ts).

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  freshDb, seedBaseScenario, seedUser, seedMatch, seedRound, seedHand,
  skipIfNoDb, type TestEnv,
} from './helpers.js';
import { applyAction } from '../../src/game/turn.js';
import { hands } from '../../src/db/schema.js';

describe.skipIf(skipIfNoDb)('fold preserves folder hole cards in the DB', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  it('preserves user A hole cards after user A folds preflop', async () => {
    const s = await seedBaseScenario(env.db);
    await applyAction(env.db, {
      handId: s.handId,
      userId: s.alice.userId,
      actionType: 'fold',
      amount: 0,
      clientTxId: 'fold-test-preflop',
    });

    const row = await env.db.query.hands.findFirst({ where: eq(hands.handId, s.handId) });
    expect(row).toBeDefined();
    expect(row!.status).toBe('complete');
    expect(row!.terminalReason).toBe('fold');
    expect(row!.foldStreet).toBe('preflop');
    expect(row!.userAHole).toEqual(['Ah', 'Ks']);
    expect(row!.userBHole).toEqual(['Qd', 'Jc']);
  });

  it('preserves user B hole cards after user B folds on the flop', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
    const round = await seedRound(env.db, match.matchId, {
      sbUserId: alice.userId, bbUserId: bob.userId,
    });
    // Flop scenario where alice (SB) has bet 40 over bob's preflop call.
    // Alice committed 10 preflop + 40 flop bet = 50. Bob committed 10
    // preflop, faces 40 to call. He folds.
    const hand = await seedHand(env.db, round.roundId, {
      street: 'flop',
      board: ['Qs', '7c', '2d'],
      pot: 60,
      userAReserved: 50,
      userBReserved: 10,
      actionOnUserId: bob.userId,
    });

    await applyAction(env.db, {
      handId: hand.handId,
      userId: bob.userId,
      actionType: 'fold',
      amount: 0,
      clientTxId: 'fold-test-flop',
    });

    const row = await env.db.query.hands.findFirst({ where: eq(hands.handId, hand.handId) });
    expect(row!.foldStreet).toBe('flop');
    expect(row!.userAHole).toEqual(['Ah', 'Ks']);
    expect(row!.userBHole).toEqual(['Qd', 'Jc']);
  });
});

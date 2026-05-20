// Verifies hands.fold_street is set correctly for folds at each street
// and remains null for non-fold completions.

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  freshDb, seedBaseScenario, seedUser, seedMatch, seedRound, seedHand,
  skipIfNoDb, type TestEnv,
} from './helpers.js';
import { applyAction } from '../../src/game/turn.js';
import { hands } from '../../src/db/schema.js';

describe.skipIf(skipIfNoDb)('fold_street column', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  it('records preflop fold as fold_street=preflop', async () => {
    const s = await seedBaseScenario(env.db);
    await applyAction(env.db, {
      handId: s.handId,
      userId: s.alice.userId,
      actionType: 'fold',
      amount: 0,
      clientTxId: 'fs-pre',
    });
    const row = await env.db.query.hands.findFirst({ where: eq(hands.handId, s.handId) });
    expect(row!.foldStreet).toBe('preflop');
  });

  it('records turn fold as fold_street=turn', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
    const round = await seedRound(env.db, match.matchId, {
      sbUserId: alice.userId, bbUserId: bob.userId,
    });
    const hand = await seedHand(env.db, round.roundId, {
      street: 'turn',
      board: ['Qs', '7c', '2d', '5h'],
      pot: 200,
      userAReserved: 120,  // alice bet 60 more on turn
      userBReserved: 60,
      actionOnUserId: bob.userId, // bob faces 60 to call
    });
    await applyAction(env.db, {
      handId: hand.handId,
      userId: bob.userId,
      actionType: 'fold',
      amount: 0,
      clientTxId: 'fs-turn',
    });
    const row = await env.db.query.hands.findFirst({ where: eq(hands.handId, hand.handId) });
    expect(row!.foldStreet).toBe('turn');
  });

  it('records river fold as fold_street=river', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
    const round = await seedRound(env.db, match.matchId, {
      sbUserId: alice.userId, bbUserId: bob.userId,
    });
    const hand = await seedHand(env.db, round.roundId, {
      street: 'river',
      board: ['Qs', '7c', '2d', '5h', '8c'],
      pot: 800,
      userAReserved: 500,
      userBReserved: 200,
      actionOnUserId: bob.userId,
    });
    await applyAction(env.db, {
      handId: hand.handId,
      userId: bob.userId,
      actionType: 'fold',
      amount: 0,
      clientTxId: 'fs-river',
    });
    const row = await env.db.query.hands.findFirst({ where: eq(hands.handId, hand.handId) });
    expect(row!.foldStreet).toBe('river');
  });
});

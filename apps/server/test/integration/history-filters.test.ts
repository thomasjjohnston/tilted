// Verifies getHistory filter semantics:
//   - favorites filter returns only the user's favorited hands
//   - result=won returns hands the user won
//   - result=lost returns hands won by the opponent (NOT splits)
//   - result=all returns all completed hands, including splits

import { describe, it, expect, beforeEach } from 'vitest';
import {
  freshDb, seedUser, seedMatch, seedRound, seedHand,
  skipIfNoDb, type TestEnv,
} from './helpers.js';
import { favorites } from '../../src/db/schema.js';
import { getHistory } from '../../src/game/history.js';

describe.skipIf(skipIfNoDb)('history filters', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  async function seedThreeCompletedHands(env: TestEnv) {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
    const round = await seedRound(env.db, match.matchId, {
      sbUserId: alice.userId, bbUserId: bob.userId,
    });
    const aliceWon = await seedHand(env.db, round.roundId, {
      handIndex: 0, status: 'complete', street: 'complete',
      winnerUserId: alice.userId, terminalReason: 'showdown',
    });
    const bobWon = await seedHand(env.db, round.roundId, {
      handIndex: 1, status: 'complete', street: 'complete',
      winnerUserId: bob.userId, terminalReason: 'showdown',
    });
    const split = await seedHand(env.db, round.roundId, {
      handIndex: 2, status: 'complete', street: 'complete',
      winnerUserId: null, terminalReason: 'showdown',
    });
    return { alice, bob, match, round, aliceWon, bobWon, split };
  }

  it('result=won returns only hands won by the user', async () => {
    const s = await seedThreeCompletedHands(env);
    const out = await getHistory(env.db, s.alice.userId, {
      favoritesOnly: false, result: 'won', limit: 20,
    });
    expect(out.hands.map(h => h.hand_id)).toEqual([s.aliceWon.handId]);
  });

  it('result=lost returns hands won by the opponent, excluding splits', async () => {
    const s = await seedThreeCompletedHands(env);
    const out = await getHistory(env.db, s.alice.userId, {
      favoritesOnly: false, result: 'lost', limit: 20,
    });
    expect(out.hands.map(h => h.hand_id)).toEqual([s.bobWon.handId]);
  });

  it('result=all returns wins, losses, and splits', async () => {
    const s = await seedThreeCompletedHands(env);
    const out = await getHistory(env.db, s.alice.userId, {
      favoritesOnly: false, result: 'all', limit: 20,
    });
    expect(out.hands.map(h => h.hand_id).sort())
      .toEqual([s.aliceWon.handId, s.bobWon.handId, s.split.handId].sort());
  });

  it('favoritesOnly returns only the user\'s favorited hands', async () => {
    const s = await seedThreeCompletedHands(env);
    // Alice favorites bobWon (not aliceWon).
    await env.db.insert(favorites).values({
      userId: s.alice.userId,
      handId: s.bobWon.handId,
    });

    const out = await getHistory(env.db, s.alice.userId, {
      favoritesOnly: true, result: 'all', limit: 20,
    });
    expect(out.hands.map(h => h.hand_id)).toEqual([s.bobWon.handId]);
  });
});

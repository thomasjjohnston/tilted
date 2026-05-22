// Verifies the showCards helper:
//   - Records indices on the correct user-side column.
//   - Subsequent calls merge (can incrementally reveal the other card).
//   - Surfaces revealed cards in the opponent's view of the hand.
//   - 4xx-equivalent errors on invalid state (hand not complete, not a
//     participant, invalid indices).

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  freshDb, seedUser, seedMatch, seedRound, seedHand,
  skipIfNoDb, type TestEnv,
} from './helpers.js';
import { showCards, getHandDetail } from '../../src/game/hand.js';
import { hands } from '../../src/db/schema.js';

describe.skipIf(skipIfNoDb)('showCards', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  async function completedHand() {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
    const round = await seedRound(env.db, match.matchId, {
      sbUserId: alice.userId, bbUserId: bob.userId,
    });
    const h = await seedHand(env.db, round.roundId, {
      userAHole: ['Ah', 'Ks'],
      userBHole: ['Qd', 'Jc'],
      board: ['2c', '5d', '9s', '7h', 'Tc'],
      status: 'complete',
      street: 'complete',
      terminalReason: 'fold',
      winnerUserId: alice.userId,
    });
    return { alice, bob, hand: h };
  }

  it('records the chosen indices for user A', async () => {
    const s = await completedHand();
    await showCards(env.db, s.hand.handId, s.alice.userId, [0]);
    const row = await env.db.query.hands.findFirst({ where: eq(hands.handId, s.hand.handId) });
    expect(row!.shownIndicesByA).toEqual([0]);
    expect(row!.shownIndicesByB).toEqual([]);
  });

  it('merges with a later call (never un-shows)', async () => {
    const s = await completedHand();
    await showCards(env.db, s.hand.handId, s.alice.userId, [0]);
    await showCards(env.db, s.hand.handId, s.alice.userId, [1]);
    const row = await env.db.query.hands.findFirst({ where: eq(hands.handId, s.hand.handId) });
    expect(row!.shownIndicesByA).toEqual([0, 1]);
  });

  it('surfaces only shown cards in the opponent view', async () => {
    const s = await completedHand();
    // Alice shows just her first card.
    await showCards(env.db, s.hand.handId, s.alice.userId, [0]);

    // Bob's view of the hand should see Alice's first card only.
    const bobView = await getHandDetail(env.db, s.hand.handId, s.bob.userId);
    expect(bobView.opponent_hole).toEqual(['Ah']);
    expect(bobView.opponent_shown_indices).toEqual([0]);
    // Bob's own cards are always visible to him.
    expect(bobView.my_hole).toEqual(['Qd', 'Jc']);

    // Alice's view still has all her own cards (`my_hole`) and sees her own shown set.
    const aliceView = await getHandDetail(env.db, s.hand.handId, s.alice.userId);
    expect(aliceView.my_hole).toEqual(['Ah', 'Ks']);
    expect(aliceView.my_shown_indices).toEqual([0]);
    // Bob hasn't shown anything → opponent_hole stays null (fold hand).
    expect(aliceView.opponent_hole).toBeNull();
  });

  it('rejects shows on an in-progress hand', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
    const round = await seedRound(env.db, match.matchId, {
      sbUserId: alice.userId, bbUserId: bob.userId,
    });
    const h = await seedHand(env.db, round.roundId, { actionOnUserId: alice.userId });

    await expect(showCards(env.db, h.handId, alice.userId, [0]))
      .rejects.toThrow('Hand is not complete');
  });

  it('rejects shows by non-participants', async () => {
    const s = await completedHand();
    const intruder = await seedUser(env.db, { displayName: 'Charlie' });
    await expect(showCards(env.db, s.hand.handId, intruder.userId, [0]))
      .rejects.toThrow('Not a participant');
  });

  it('rejects empty indices', async () => {
    const s = await completedHand();
    await expect(showCards(env.db, s.hand.handId, s.alice.userId, []))
      .rejects.toThrow('Must show at least one card');
  });

  it('rejects out-of-range indices', async () => {
    const s = await completedHand();
    await expect(showCards(env.db, s.hand.handId, s.alice.userId, [2]))
      .rejects.toThrow('Invalid card index');
  });
});

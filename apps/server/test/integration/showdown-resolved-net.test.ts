// Verifies that the showdown settlement writes resolved_net values
// summing to zero. The winner-determination is engine-level; here we
// only assert the chip-ledger invariant.

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  freshDb, seedUser, seedMatch, seedRound, seedHand,
  skipIfNoDb, type TestEnv,
} from './helpers.js';
import { applyAction } from '../../src/game/turn.js';
import { hands } from '../../src/db/schema.js';

describe.skipIf(skipIfNoDb)('showdown resolved_net snapshot', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  it('sums to zero after river call drives the hand to showdown', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
    const round = await seedRound(env.db, match.matchId, {
      sbUserId: alice.userId, bbUserId: bob.userId,
    });

    // River street: bob (BB) has bet 200 over alice's 100; alice on action.
    // Alice calls — drives the hand to showdown.
    const hand = await seedHand(env.db, round.roundId, {
      street: 'river',
      board: ['Qs', '7c', '2d', '5h', '8c'],
      pot: 300,
      userAReserved: 100,
      userBReserved: 200,
      actionOnUserId: alice.userId,
    });

    await applyAction(env.db, {
      handId: hand.handId,
      userId: alice.userId,
      actionType: 'call',
      amount: 0,
      clientTxId: 'sd-call',
    });

    const row = await env.db.query.hands.findFirst({ where: eq(hands.handId, hand.handId) });
    expect(row!.status).toBe('complete');
    expect(row!.terminalReason).toBe('showdown');
    expect(row!.foldStreet).toBeNull();
    expect(row!.resolvedNetForA).not.toBeNull();
    expect(row!.resolvedNetForB).not.toBeNull();
    // Chip-ledger invariant: A's delta + B's delta = 0 (zero-sum).
    const totalDelta = (row!.resolvedNetForA ?? 0) + (row!.resolvedNetForB ?? 0);
    expect(totalDelta).toBe(0);
  });
});

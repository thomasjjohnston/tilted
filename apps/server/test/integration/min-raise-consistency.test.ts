// Regression for the "invalid raise bounces the hand back" bug (S7-4):
// the min-raise advertised by getLegalActions must be exactly what the
// action path enforces. Previously getLegalActions used blindBig for
// lastRaiseSize while applyAction reconstructed a larger one, so a raise
// at the advertised minimum 500'd and the hand silently reappeared.

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  freshDb, seedUser, seedMatch, seedRound, seedHand, skipIfNoDb, type TestEnv,
} from './helpers.js';
import { applyAction, getLegalActions } from '../../src/game/turn.js';
import { GameRuleError } from '../../src/errors.js';
import { hands } from '../../src/db/schema.js';

describe.skipIf(skipIfNoDb)('min-raise: advertised === enforced', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  it('accepts a raise at the advertised minimum when facing a large bet', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
    const round = await seedRound(env.db, match.matchId, { sbUserId: alice.userId, bbUserId: bob.userId });
    // Flop: bob has bet 200 over the street-start level of 100. Alice faces 200.
    const hand = await seedHand(env.db, round.roundId, {
      street: 'flop', board: ['Qs', '7c', '2d'], pot: 400,
      userAReserved: 100, userBReserved: 300, actionOnUserId: alice.userId,
    });

    const legal = await getLegalActions(env.db, hand.handId, alice.userId);
    expect(legal.actions).toContain('raise');
    // last raise size = toCall = 200 → min-raise amount = (300+200) - 100 = 400
    expect(legal.min_raise).toBe(400);

    // A raise one below the advertised minimum is rejected as a game rule error.
    await expect(applyAction(env.db, {
      handId: hand.handId, userId: alice.userId, actionType: 'raise',
      amount: legal.min_raise - 1, clientTxId: 'below-min',
    })).rejects.toBeInstanceOf(GameRuleError);

    // The advertised minimum itself is accepted — no bounce-back.
    await applyAction(env.db, {
      handId: hand.handId, userId: alice.userId, actionType: 'raise',
      amount: legal.min_raise, clientTxId: 'at-min',
    });

    const row = await env.db.query.hands.findFirst({ where: eq(hands.handId, hand.handId) });
    expect(row!.actionOnUserId).toBe(bob.userId);        // action passed to bob
    expect(row!.userAReserved).toBe(100 + legal.min_raise); // alice's raise committed
  });
});

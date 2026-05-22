// Verifies reconstructResolvedNet — the pure function the backfill
// script uses — matches the server's settlement math.

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  freshDb, seedBaseScenario, skipIfNoDb, type TestEnv,
} from './helpers.js';
import { applyAction } from '../../src/game/turn.js';
import { hands, actions } from '../../src/db/schema.js';
import { reconstructResolvedNet } from '../../src/db/backfill-resolved-net.js';

describe.skipIf(skipIfNoDb)('reconstructResolvedNet matches settlement math', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  it('reconstructs preflop fold correctly', async () => {
    const s = await seedBaseScenario(env.db);
    await applyAction(env.db, {
      handId: s.handId,
      userId: s.alice.userId,
      actionType: 'fold',
      amount: 0,
      clientTxId: 'reconstruct-test',
    });

    const truth = await env.db.query.hands.findFirst({ where: eq(hands.handId, s.handId) });
    const handActions = await env.db.query.actions.findMany({ where: eq(actions.handId, s.handId) });

    const { aDelta, bDelta } = reconstructResolvedNet({
      userAId: s.alice.userId,
      userBId: s.bob.userId,
      sbUserId: s.alice.userId,   // alice is SB in the base scenario
      blindSmall: 5,
      blindBig: 10,
      pot: truth!.pot,
      winnerUserId: truth!.winnerUserId,
      actions: handActions.map(a => ({ actingUserId: a.actingUserId, amount: a.amount })),
    });

    expect(aDelta).toBe(truth!.resolvedNetForA);
    expect(bDelta).toBe(truth!.resolvedNetForB);
  });

  it('reconstructs split pot with odd chip to BB', () => {
    const userA = 'user-a';
    const userB = 'user-b';
    // userA is SB, pot 15 (odd) split: BB (userB) gets the extra chip.
    const { aDelta, bDelta } = reconstructResolvedNet({
      userAId: userA, userBId: userB,
      sbUserId: userA,
      blindSmall: 5, blindBig: 10,
      pot: 15,
      winnerUserId: null,   // split
      actions: [],
    });
    expect(aDelta).toBe(7 - 5);   // floor(15/2)=7, no remainder for SB
    expect(bDelta).toBe(8 - 10);  // floor(15/2)+1=8, minus BB contribution
    expect(aDelta + bDelta).toBe(0);
  });
});

// Verifies the cart / batch turn submit (applyTurnBatch, spec §6):
//   - applies every queued action atomically in one transaction
//   - all-or-nothing: one illegal action rolls the whole turn back
//   - idempotent by per-action client_tx_id
//   - fires at most ONE turn handoff for the whole submitted turn

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  freshDb, seedUser, seedMatch, seedRound, seedHand, skipIfNoDb, type TestEnv,
} from './helpers.js';
import { applyTurnBatch } from '../../src/game/turn.js';
import { GameRuleError } from '../../src/errors.js';
import { hands, actions, turnHandoffs } from '../../src/db/schema.js';

async function seedTwoHandTurn(db: TestEnv['db']) {
  const alice = await seedUser(db, { displayName: 'Alice' });
  const bob = await seedUser(db, { displayName: 'Bob' });
  const match = await seedMatch(db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
  const round = await seedRound(db, match.matchId, { sbUserId: alice.userId, bbUserId: bob.userId });
  // Two preflop hands, both action on alice (SB). Blinds posted.
  const h0 = await seedHand(db, round.roundId, { handIndex: 0, actionOnUserId: alice.userId });
  const h1 = await seedHand(db, round.roundId, { handIndex: 1, actionOnUserId: alice.userId });
  return { alice, bob, match, round, h0, h1 };
}

describe.skipIf(skipIfNoDb)('applyTurnBatch — cart submit', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  it('applies all queued actions in one turn and fires exactly one handoff', async () => {
    const s = await seedTwoHandTurn(env.db);

    await applyTurnBatch(env.db, s.alice.userId, {
      actions: [
        { handId: s.h0.handId, actionType: 'fold', amount: 0, clientTxId: 'b-h0' },
        { handId: s.h1.handId, actionType: 'call', amount: 0, clientTxId: 'b-h1' },
      ],
    });

    const h0 = await env.db.query.hands.findFirst({ where: eq(hands.handId, s.h0.handId) });
    const h1 = await env.db.query.hands.findFirst({ where: eq(hands.handId, s.h1.handId) });
    expect(h0!.status).toBe('complete');          // folded
    expect(h0!.winnerUserId).toBe(s.bob.userId);
    expect(h1!.status).toBe('in_progress');        // SB completed → BB to act
    expect(h1!.actionOnUserId).toBe(s.bob.userId);

    // Alice has no pending hands, bob has one → exactly one handoff row.
    const handoffs = await env.db.query.turnHandoffs.findMany({ where: eq(turnHandoffs.roundId, s.round.roundId) });
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].toUserId).toBe(s.bob.userId);
  });

  it('is all-or-nothing: an illegal action rolls back the entire turn', async () => {
    const s = await seedTwoHandTurn(env.db);

    // 'check' is illegal preflop for the SB facing the big blind.
    await expect(applyTurnBatch(env.db, s.alice.userId, {
      actions: [
        { handId: s.h0.handId, actionType: 'call', amount: 0, clientTxId: 'nn-h0' },
        { handId: s.h1.handId, actionType: 'check', amount: 0, clientTxId: 'nn-h1' },
      ],
    })).rejects.toBeInstanceOf(GameRuleError);

    // Nothing applied — no actions recorded, both hands untouched.
    const recorded = await env.db.query.actions.findMany({ where: eq(actions.handId, s.h0.handId) });
    expect(recorded).toHaveLength(0);
    const h0 = await env.db.query.hands.findFirst({ where: eq(hands.handId, s.h0.handId) });
    expect(h0!.actionOnUserId).toBe(s.alice.userId); // still alice's turn
  });

  it('is idempotent — resubmitting the same turn does not double-apply', async () => {
    const s = await seedTwoHandTurn(env.db);
    const batch = {
      actions: [
        { handId: s.h0.handId, actionType: 'fold' as const, amount: 0, clientTxId: 'idem-h0' },
        { handId: s.h1.handId, actionType: 'fold' as const, amount: 0, clientTxId: 'idem-h1' },
      ],
    };

    await applyTurnBatch(env.db, s.alice.userId, batch);
    await applyTurnBatch(env.db, s.alice.userId, batch); // retry

    const h0Actions = await env.db.query.actions.findMany({ where: eq(actions.handId, s.h0.handId) });
    expect(h0Actions).toHaveLength(1); // not two
    // Both hands folded → round has no pending; no handoff (round complete).
    const handoffs = await env.db.query.turnHandoffs.findMany({ where: eq(turnHandoffs.roundId, s.round.roundId) });
    expect(handoffs).toHaveLength(0);
  });
});

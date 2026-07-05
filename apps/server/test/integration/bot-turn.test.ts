// Untilted bot orchestration: the bot takes real turns through the normal
// transactional machinery, from its own user-scoped view, gated by allowlist.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actions, hands, solverMeta, solverStrategies, users } from '../../src/db/schema.js';
import { runBotTurnIfPending, userMayAccessBot } from '../../src/game/bot.js';
import { createMatch } from '../../src/game/match.js';
import { applyTurnBatch } from '../../src/game/turn.js';
import { freshDb, seedHand, seedMatch, seedRound, seedUser, type TestEnv } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const solverConfig = JSON.parse(
  readFileSync(join(here, '..', 'engine', 'fixtures', 'solver-conformance.json'), 'utf-8'),
).config;

async function seedBot(db: TestEnv['db']): Promise<string> {
  const [bot] = await db.insert(users).values({ displayName: 'Untilted', isBot: true }).returning();
  return bot.userId;
}

async function seedSolverMeta(db: TestEnv['db']) {
  await db.insert(solverMeta).values([
    { key: 'config', value: solverConfig },
    { key: 'buckets', value: { flop: [0.5], turn: [0.5], river: [0.5], ehs_samples: 32 } },
    { key: 'depths', value: [200] },
  ]);
}

/** Insert one strategy for every preflop class at (depth 200, street 0, seq). */
async function seedPreflopStrategy(
  db: TestEnv['db'],
  seq: string,
  tokens: string[],
  strategy: number[],
) {
  const rows = [];
  for (let bucket = 0; bucket < 169; bucket++) {
    rows.push({ depthBb: 200, street: 0, seq, bucket, tokens, strategy });
  }
  await db.insert(solverStrategies).values(rows);
}

describe('untilted bot turns', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await freshDb();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('responds to a handoff: folds every bucket to an open when told to', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const botId = await seedBot(env.db);
    const { matchId } = await seedMatch(env.db, alice.userId, botId);
    const { roundId } = await seedRound(env.db, matchId, { sbUserId: alice.userId, bbUserId: botId });
    const { handId } = await seedHand(env.db, roundId, { actionOnUserId: alice.userId });

    await seedSolverMeta(env.db);
    // Facing the 2.5x open (seq "r0"): pure fold in every bucket.
    await seedPreflopStrategy(env.db, 'r0', ['f', 'c', 'r0', 'r1', 'a'], [1, 0, 0, 0, 0]);

    // Alice opens to 25 (increment 20 over her posted 5).
    await applyTurnBatch(env.db, alice.userId, {
      actions: [{ handId, actionType: 'raise', amount: 20, clientTxId: 'alice-open' }],
    });

    // The bot should have acted immediately (post-commit trigger): fold.
    const botActions = await env.db.query.actions.findMany({
      where: eq(actions.actingUserId, botId),
    });
    expect(botActions).toHaveLength(1);
    expect(botActions[0].actionType).toBe('fold');
    expect(botActions[0].clientTxId).toMatch(/^untilted-/);

    const hand = await env.db.query.hands.findFirst({ where: eq(hands.handId, handId) });
    expect(hand!.status).toBe('complete');
    expect(hand!.winnerUserId).toBe(alice.userId);
  });

  it('acts first as SB and hands control to the human', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const botId = await seedBot(env.db);
    const { matchId } = await seedMatch(env.db, botId, alice.userId);
    const { roundId } = await seedRound(env.db, matchId, { sbUserId: botId, bbUserId: alice.userId });
    // Bot is user A here: its hole is userAHole; SB posted 5, BB 10.
    const { handId } = await seedHand(env.db, roundId, {
      userAReserved: 5, userBReserved: 10, actionOnUserId: botId,
    });

    await seedSolverMeta(env.db);
    // Root (seq ""): always limp.
    await seedPreflopStrategy(env.db, '', ['f', 'c', 'r0', 'r1', 'a'], [0, 1, 0, 0, 0]);

    const acted = await runBotTurnIfPending(env.db, matchId, botId);
    expect(acted).toBe(true);

    const botActions = await env.db.query.actions.findMany({
      where: eq(actions.actingUserId, botId),
      orderBy: [asc(actions.serverRecordedAt)],
    });
    expect(botActions).toHaveLength(1);
    expect(botActions[0].actionType).toBe('call'); // limp completes the SB

    const hand = await env.db.query.hands.findFirst({ where: eq(hands.handId, handId) });
    expect(hand!.actionOnUserId).toBe(alice.userId); // BB has the option

    const handoffs = await env.db.query.turnHandoffs.findMany();
    expect(handoffs.some(h => h.toUserId === alice.userId)).toBe(true);
  });

  it('falls back passively off-book: folds to a large bet with no strategies', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const botId = await seedBot(env.db);
    const { matchId } = await seedMatch(env.db, alice.userId, botId);
    const { roundId } = await seedRound(env.db, matchId, { sbUserId: alice.userId, bbUserId: botId });
    const { handId } = await seedHand(env.db, roundId, { actionOnUserId: alice.userId });

    await seedSolverMeta(env.db); // meta present, zero strategy rows

    // Alice raises to 100 (increment 95): to-call 90 >> 2bb, off-book folds.
    await applyTurnBatch(env.db, alice.userId, {
      actions: [{ handId, actionType: 'raise', amount: 95, clientTxId: 'alice-big' }],
    });

    const hand = await env.db.query.hands.findFirst({ where: eq(hands.handId, handId) });
    expect(hand!.status).toBe('complete');
    expect(hand!.winnerUserId).toBe(alice.userId);
    const botActions = await env.db.query.actions.findMany({ where: eq(actions.actingUserId, botId) });
    expect(botActions[0].actionType).toBe('fold');
  });

  it('leaves the turn pending when no strategies are imported at all', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const botId = await seedBot(env.db);
    const { matchId } = await seedMatch(env.db, alice.userId, botId);
    const { roundId } = await seedRound(env.db, matchId, { sbUserId: alice.userId, bbUserId: botId });
    const { handId } = await seedHand(env.db, roundId, { actionOnUserId: alice.userId });
    // No solver_meta at all.

    await applyTurnBatch(env.db, alice.userId, {
      actions: [{ handId, actionType: 'raise', amount: 20, clientTxId: 'alice-open2' }],
    });

    // Human turn applied; bot did nothing; hand waits on the bot.
    const hand = await env.db.query.hands.findFirst({ where: eq(hands.handId, handId) });
    expect(hand!.status).toBe('in_progress');
    expect(hand!.actionOnUserId).toBe(botId);
  });
});

describe('untilted access gating', () => {
  let env: TestEnv;
  const savedEnv = process.env.TILTED_BOT_TESTERS;

  beforeEach(async () => {
    env = await freshDb();
  });

  afterEach(async () => {
    process.env.TILTED_BOT_TESTERS = savedEnv;
    await env.cleanup();
  });

  it('allowlist semantics', () => {
    process.env.TILTED_BOT_TESTERS = '';
    expect(userMayAccessBot('anyone')).toBe(false);
    process.env.TILTED_BOT_TESTERS = 'user-a, user-b';
    expect(userMayAccessBot('user-a')).toBe(true);
    expect(userMayAccessBot('user-c')).toBe(false);
    process.env.TILTED_BOT_TESTERS = '*';
    expect(userMayAccessBot('user-c')).toBe(true);
  });

  it('createMatch refuses bot challenges from non-testers and hides the reason', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const botId = await seedBot(env.db);

    process.env.TILTED_BOT_TESTERS = '';
    await expect(createMatch(env.db, alice.userId, botId)).rejects.toThrow('Opponent not found');

    process.env.TILTED_BOT_TESTERS = alice.userId;
    const match = await createMatch(env.db, alice.userId, botId);
    expect(match.status).toBe('active');
  });

  it('the bot can never initiate a match', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const botId = await seedBot(env.db);
    process.env.TILTED_BOT_TESTERS = '*';
    await expect(createMatch(env.db, botId, alice.userId)).rejects.toThrow('Bot cannot initiate');
  });
});

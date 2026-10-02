// "Play Untilted": a dedicated way to start a match against the bot, and a
// way for the client to know whether to offer it. The bot is only offered
// when it can actually play: a bot user exists, strategies are imported,
// and the requesting user passes the access gate.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedMatch, seedUser, skipIfNoDb, type TestEnv } from '../integration/helpers.js';
import { matches, solverMeta, users } from '../../src/db/schema.js';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

vi.mock('../../src/notif/dispatchers.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}));

const { buildApp } = await import('../../src/app.js');
const { setDb } = await import('../../src/api/context.js');
const { mintToken } = await import('../../src/auth/tokens.js');

async function seedBot(db: TestEnv['db']): Promise<string> {
  const [bot] = await db.insert(users).values({ displayName: 'Untilted', isBot: true }).returning();
  return bot.userId;
}

async function seedSolverMeta(db: TestEnv['db']) {
  await db.insert(solverMeta).values([
    { key: 'config', value: {} },
    { key: 'buckets', value: { flop: [0.5], turn: [0.5], river: [0.5], ehs_samples: 32 } },
    { key: 'depths', value: [200] },
  ]);
}

describe.skipIf(skipIfNoDb)('play the bot', () => {
  let env: TestEnv;
  let token: string;
  let aliceId: string;
  const savedGate = process.env.TILTED_BOT_TESTERS;

  beforeEach(async () => {
    env = await freshDb();
    setDb(env.db);
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    aliceId = alice.userId;
    token = await mintToken(env.db, aliceId);
    process.env.TILTED_BOT_TESTERS = '*';
  });

  afterEach(() => {
    process.env.TILTED_BOT_TESTERS = savedGate;
  });

  async function call(method: 'GET' | 'POST', url: string) {
    const app = await buildApp();
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });
    await app.close();
    return res;
  }

  it('reports unavailable when there is no bot user', async () => {
    await seedSolverMeta(env.db);
    const res = await call('GET', '/v1/bot');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false });
  });

  it('reports unavailable when no strategies are imported', async () => {
    await seedBot(env.db);
    expect((await call('GET', '/v1/bot')).json()).toEqual({ available: false });
    expect((await call('POST', '/v1/match/bot')).statusCode).toBe(503);
    expect(await env.db.query.matches.findMany()).toHaveLength(0);
  });

  it('reports unavailable to users outside the access gate', async () => {
    await seedBot(env.db);
    await seedSolverMeta(env.db);
    process.env.TILTED_BOT_TESTERS = '';
    expect((await call('GET', '/v1/bot')).json()).toEqual({ available: false });
    expect((await call('POST', '/v1/match/bot')).statusCode).toBe(503);
  });

  it('reports the bot when it can play', async () => {
    const botId = await seedBot(env.db);
    await seedSolverMeta(env.db);
    expect((await call('GET', '/v1/bot')).json()).toEqual({
      available: true, user_id: botId, display_name: 'Untilted',
    });
  });

  it('starts a match against the bot and flags the opponent as a bot', async () => {
    const botId = await seedBot(env.db);
    await seedSolverMeta(env.db);
    const res = await call('POST', '/v1/match/bot');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('active');
    expect(body.opponent).toMatchObject({ user_id: botId, display_name: 'Untilted', is_bot: true });
    // Redaction still applies to bot matches: never the bot's hole cards.
    for (const h of body.current_round.hands) {
      expect(h.opponent_hole).toBeNull();
    }
  });

  it('still succeeds when the bot fails on its opening turn', async () => {
    await seedBot(env.db);
    await seedSolverMeta(env.db); // config {} makes the bot's decision throw
    // Force the coin flip so the bot is SB and must act first.
    const coin = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await call('POST', '/v1/match/bot');
      expect(res.statusCode).toBe(200);
      expect(res.json().current_round.my_role).toBe('bb');
      expect(errors).toHaveBeenCalled();
    } finally {
      coin.mockRestore();
      errors.mockRestore();
    }
    expect(await env.db.query.matches.findMany()).toHaveLength(1);
  });

  it('returns 409 when a bot match is already in progress', async () => {
    await seedBot(env.db);
    await seedSolverMeta(env.db);
    expect((await call('POST', '/v1/match/bot')).statusCode).toBe(200);
    expect((await call('POST', '/v1/match/bot')).statusCode).toBe(409);
    expect(await env.db.query.matches.findMany()).toHaveLength(1);
  });

  it('flags a human opponent as not a bot', async () => {
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    // Rematches need a previous match on record (spec §25).
    const prior = await seedMatch(env.db, aliceId, bob.userId);
    await env.db.update(matches).set({ status: 'ended', winnerUserId: aliceId, endedAt: new Date() })
      .where(eq(matches.matchId, prior.matchId));
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/v1/match',
      headers: { authorization: `Bearer ${token}` },
      payload: { opponent_user_id: bob.userId },
    });
    await app.close();
    expect(res.json().opponent.is_bot).toBe(false);
  });
});

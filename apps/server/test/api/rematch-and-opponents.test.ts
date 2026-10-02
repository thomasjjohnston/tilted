// With invites in place there is no public list of players (spec §25/§26):
//   - GET /v1/opponents lists only people you have already played
//   - POST /v1/match only starts a rematch with one of them
//   - the legacy GET /v1/users no longer exposes strangers

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser, seedMatch, skipIfNoDb, type TestEnv } from '../integration/helpers.js';
import { matches, users } from '../../src/db/schema.js';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

vi.mock('../../src/notif/dispatchers.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}));

const { buildApp } = await import('../../src/app.js');
const { setDb } = await import('../../src/api/context.js');
const { mintToken } = await import('../../src/auth/tokens.js');
const { deleteAccount } = await import('../../src/game/account.js');

describe.skipIf(skipIfNoDb)('rematch and opponents', () => {
  let env: TestEnv;
  let alice: { userId: string; token: string };
  let bob: { userId: string };
  let stranger: { userId: string };

  beforeEach(async () => {
    env = await freshDb();
    setDb(env.db);
    const a = await seedUser(env.db, { displayName: 'Alice Liddell' });
    alice = { userId: a.userId, token: await mintToken(env.db, a.userId) };
    bob = await seedUser(env.db, { displayName: 'Bob Stone' });
    stranger = await seedUser(env.db, { displayName: 'Stranger Danger' });
  });

  async function call(method: 'GET' | 'POST', url: string, payload?: unknown) {
    const app = await buildApp();
    const res = await app.inject({
      method, url, payload: payload as never,
      headers: { authorization: `Bearer ${alice.token}` },
    });
    await app.close();
    return res;
  }

  async function endedMatch(a: string, b: string, endedAt = new Date()) {
    const m = await seedMatch(env.db, a, b);
    await env.db.update(matches).set({ status: 'ended', winnerUserId: a, endedAt, startedAt: endedAt })
      .where(eq(matches.matchId, m.matchId));
    return m;
  }

  it('lists nobody for a new player', async () => {
    const res = await call('GET', '/v1/opponents');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('lists only people you have played, whichever side you were on', async () => {
    await endedMatch(alice.userId, bob.userId);
    const carol = await seedUser(env.db, { displayName: 'Carol' });
    await endedMatch(carol.userId, alice.userId);
    await endedMatch(bob.userId, stranger.userId); // not Alice's match

    const list = (await call('GET', '/v1/opponents')).json() as { user_id: string }[];
    expect(list.map(o => o.user_id).sort()).toEqual([bob.userId, carol.userId].sort());
  });

  it('returns safe fields only and flags an active match', async () => {
    await endedMatch(alice.userId, bob.userId);
    await seedMatch(env.db, alice.userId, bob.userId); // active
    await env.db.update(users).set({ email: 'bob@example.com', appleSub: 'sub-bob', apnsToken: 'tok' })
      .where(eq(users.userId, bob.userId));

    const [entry] = (await call('GET', '/v1/opponents')).json();
    expect(Object.keys(entry).sort()).toEqual(
      ['display_name', 'has_active_match', 'initials', 'last_played_at', 'user_id'],
    );
    expect(entry).toMatchObject({
      user_id: bob.userId, display_name: 'Bob Stone', initials: 'BS', has_active_match: true,
    });
  });

  it('orders by most recently played', async () => {
    const carol = await seedUser(env.db, { displayName: 'Carol' });
    await endedMatch(alice.userId, bob.userId, new Date('2026-01-01T00:00:00Z'));
    await endedMatch(alice.userId, carol.userId, new Date('2026-06-01T00:00:00Z'));
    const list = (await call('GET', '/v1/opponents')).json() as { user_id: string }[];
    expect(list.map(o => o.user_id)).toEqual([carol.userId, bob.userId]);
  });

  it('hides deleted players and the bot', async () => {
    await endedMatch(alice.userId, bob.userId);
    const [bot] = await env.db.insert(users).values({ displayName: 'Untilted', isBot: true }).returning();
    await endedMatch(alice.userId, bot.userId);
    await deleteAccount(env.db, bob.userId, 'user_deleted');
    expect((await call('GET', '/v1/opponents')).json()).toEqual([]);
  });

  it('legacy GET /v1/users is the same list, never strangers', async () => {
    await endedMatch(alice.userId, bob.userId);
    const list = (await call('GET', '/v1/users')).json() as { user_id: string }[];
    expect(list.map(u => u.user_id)).toEqual([bob.userId]);
  });

  it('rematch with a previous opponent starts a match', async () => {
    await endedMatch(alice.userId, bob.userId);
    const res = await call('POST', '/v1/match', { opponent_user_id: bob.userId });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'active', opponent: { user_id: bob.userId } });
  });

  it('challenging someone you have never played is refused as not found', async () => {
    const res = await call('POST', '/v1/match', { opponent_user_id: stranger.userId });
    expect(res.statusCode).toBe(404);
    expect(await env.db.query.matches.findMany()).toHaveLength(0);
  });

  it('a non-existent user id looks the same as a stranger', async () => {
    const res = await call('POST', '/v1/match', { opponent_user_id: '00000000-0000-4000-8000-000000000000' });
    expect(res.statusCode).toBe(404);
  });

  it('rematch while a match is active is 409', async () => {
    await endedMatch(alice.userId, bob.userId);
    await seedMatch(env.db, alice.userId, bob.userId);
    const res = await call('POST', '/v1/match', { opponent_user_id: bob.userId });
    expect(res.statusCode).toBe(409);
  });

  it('cannot rematch a deleted player', async () => {
    await endedMatch(alice.userId, bob.userId);
    await deleteAccount(env.db, bob.userId, 'user_deleted');
    const res = await call('POST', '/v1/match', { opponent_user_id: bob.userId });
    expect(res.statusCode).toBe(404);
  });
});

// Blocking (spec §27): either player can cut off someone they have played.
// It ends their active match as abandoned, stops rematches and invites in
// both directions, hides each from the other's rematch list, and is undone
// by unblocking. The blocked player is never told.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser, seedMatch, seedBaseScenario, skipIfNoDb, type TestEnv } from '../integration/helpers.js';
import { matches, users, pendingReminders, hands } from '../../src/db/schema.js';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const dispatchMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/notif/dispatchers.js', () => ({
  dispatch: (...args: unknown[]) => dispatchMock(...args),
}));

const { buildApp } = await import('../../src/app.js');
const { setDb } = await import('../../src/api/context.js');
const { mintToken } = await import('../../src/auth/tokens.js');
const { createInvite } = await import('../../src/game/invites.js');
const { applyTurnBatch } = await import('../../src/game/turn.js');

type Who = { userId: string; token: string };

describe.skipIf(skipIfNoDb)('blocking', () => {
  let env: TestEnv;
  let alice: Who;
  let bob: Who;

  beforeEach(async () => {
    env = await freshDb();
    setDb(env.db);
    dispatchMock.mockClear();
  });

  async function withToken(userId: string): Promise<Who> {
    return { userId, token: await mintToken(env.db, userId) };
  }

  /** Alice and Bob with one ended match on record. */
  async function seedPair() {
    alice = await withToken((await seedUser(env.db, { displayName: 'Alice Liddell' })).userId);
    bob = await withToken((await seedUser(env.db, { displayName: 'Bob Stone' })).userId);
    const m = await seedMatch(env.db, alice.userId, bob.userId);
    await env.db.update(matches).set({ status: 'ended', winnerUserId: alice.userId, endedAt: new Date() })
      .where(eq(matches.matchId, m.matchId));
  }

  async function call(who: Who, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) {
    const app = await buildApp();
    const res = await app.inject({
      method, url, payload: payload as never,
      headers: { authorization: `Bearer ${who.token}` },
    });
    await app.close();
    return res;
  }

  const block = (who: Who, target: string) => call(who, 'POST', '/v1/blocks', { user_id: target });

  it('blocks a previous opponent and lists them with safe fields', async () => {
    await seedPair();
    expect((await block(alice, bob.userId)).statusCode).toBe(204);
    const list = (await call(alice, 'GET', '/v1/blocks')).json();
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(['blocked_at', 'display_name', 'initials', 'user_id']);
    expect(list[0]).toMatchObject({ user_id: bob.userId, display_name: 'Bob Stone', initials: 'BS' });
    // Bob's own block list is unaffected: he is not told.
    expect((await call(bob, 'GET', '/v1/blocks')).json()).toEqual([]);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('is idempotent', async () => {
    await seedPair();
    expect((await block(alice, bob.userId)).statusCode).toBe(204);
    expect((await block(alice, bob.userId)).statusCode).toBe(204);
    expect((await call(alice, 'GET', '/v1/blocks')).json()).toHaveLength(1);
  });

  it('refuses to block yourself, a stranger, an unknown id, or the bot', async () => {
    await seedPair();
    const stranger = await seedUser(env.db, { displayName: 'Stranger' });
    const [bot] = await env.db.insert(users).values({ displayName: 'Untilted', isBot: true }).returning();
    const botMatch = await seedMatch(env.db, alice.userId, bot.userId);
    await env.db.update(matches).set({ status: 'ended', endedAt: new Date() }).where(eq(matches.matchId, botMatch.matchId));

    expect((await block(alice, alice.userId)).statusCode).toBe(400);
    expect((await block(alice, stranger.userId)).statusCode).toBe(404);
    expect((await block(alice, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await block(alice, bot.userId)).statusCode).toBe(400);
    expect((await call(alice, 'GET', '/v1/blocks')).json()).toEqual([]);
  });

  it('stops rematches in both directions and hides each from the other', async () => {
    await seedPair();
    await block(alice, bob.userId);

    expect((await call(alice, 'POST', '/v1/match', { opponent_user_id: bob.userId })).statusCode).toBe(404);
    expect((await call(bob, 'POST', '/v1/match', { opponent_user_id: alice.userId })).statusCode).toBe(404);
    expect((await call(alice, 'GET', '/v1/opponents')).json()).toEqual([]);
    expect((await call(bob, 'GET', '/v1/opponents')).json()).toEqual([]);
    expect(await env.db.query.matches.findMany({ where: eq(matches.status, 'active') })).toHaveLength(0);
  });

  it('stops invites in both directions without consuming them', async () => {
    await seedPair();
    await block(alice, bob.userId);
    const fromAlice = await createInvite(env.db, alice.userId, 'tx-block-0001');
    const fromBob = await createInvite(env.db, bob.userId, 'tx-block-0002');

    const r1 = await call(bob, 'POST', `/v1/invites/${fromAlice.code}/redeem`);
    const r2 = await call(alice, 'POST', `/v1/invites/${fromBob.code}/redeem`);
    expect(r1.statusCode).toBe(404);
    expect(r2.statusCode).toBe(404);
    expect(r1.json().error).toBe('not_found');
    expect(await env.db.query.matches.findMany({ where: eq(matches.status, 'active') })).toHaveLength(0);
  });

  it('ends the active match as abandoned: no winner, frozen, reminders gone, history kept', async () => {
    const s = await seedBaseScenario(env.db);
    alice = await withToken(s.alice.userId);
    bob = await withToken(s.bob.userId);
    await env.db.insert(pendingReminders).values({
      kind: 'turn_handoff', userId: bob.userId, matchId: s.matchId, roundId: s.roundId,
      dueAt: new Date(Date.now() + 60_000),
    });

    expect((await block(bob, alice.userId)).statusCode).toBe(204);

    const match = await env.db.query.matches.findFirst({ where: eq(matches.matchId, s.matchId) });
    expect(match!.status).toBe('abandoned');
    expect(match!.winnerUserId).toBeNull();
    expect(match!.endedAt).not.toBeNull();
    expect(match!.userATotal).toBe(2000);
    expect(match!.userBTotal).toBe(2000);
    expect(await env.db.query.pendingReminders.findMany()).toHaveLength(0);
    expect(await env.db.query.hands.findFirst({ where: eq(hands.handId, s.handId) })).toBeDefined();

    // Neither player sees it as active, and it cannot be acted on.
    expect((await call(alice, 'GET', '/v1/matches')).json()).toEqual([]);
    expect((await call(bob, 'GET', '/v1/matches')).json()).toEqual([]);
    await expect(applyTurnBatch(env.db, alice.userId, {
      actions: [{ handId: s.handId, actionType: 'fold', amount: 0, clientTxId: 'tx-after-block' }],
    })).rejects.toThrow('Match is not active');
  });

  it('leaves matches with other people alone', async () => {
    await seedPair();
    const carol = await seedUser(env.db, { displayName: 'Carol' });
    const other = await seedMatch(env.db, alice.userId, carol.userId);
    await block(alice, bob.userId);
    const m = await env.db.query.matches.findFirst({ where: eq(matches.matchId, other.matchId) });
    expect(m!.status).toBe('active');
  });

  it('unblocking restores rematch; the abandoned match stays abandoned', async () => {
    const s = await seedBaseScenario(env.db);
    alice = await withToken(s.alice.userId);
    bob = await withToken(s.bob.userId);
    await block(alice, bob.userId);

    expect((await call(alice, 'DELETE', `/v1/blocks/${bob.userId}`)).statusCode).toBe(204);
    expect((await call(alice, 'DELETE', `/v1/blocks/${bob.userId}`)).statusCode).toBe(204); // idempotent
    expect((await call(alice, 'GET', '/v1/blocks')).json()).toEqual([]);

    const old = await env.db.query.matches.findFirst({ where: eq(matches.matchId, s.matchId) });
    expect(old!.status).toBe('abandoned');
    const res = await call(bob, 'POST', '/v1/match', { opponent_user_id: alice.userId });
    expect(res.statusCode).toBe(200);
  });

  it('only the blocker can lift their block', async () => {
    await seedPair();
    await block(alice, bob.userId);
    expect((await call(bob, 'DELETE', `/v1/blocks/${alice.userId}`)).statusCode).toBe(204);
    expect((await call(bob, 'POST', '/v1/match', { opponent_user_id: alice.userId })).statusCode).toBe(404);
  });
});

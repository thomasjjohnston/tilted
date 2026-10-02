// Invites (spec §25): a single-use link/code is how two friends start a
// match. Creating is idempotent; redeeming starts the match atomically,
// is idempotent for the same redeemer, and refuses every invalid case
// without creating anything.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser, skipIfNoDb, type TestEnv } from '../integration/helpers.js';
import { invites, matches } from '../../src/db/schema.js';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const dispatchMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/notif/dispatchers.js', () => ({
  dispatch: (...args: unknown[]) => dispatchMock(...args),
}));

const { buildApp } = await import('../../src/app.js');
const { setDb } = await import('../../src/api/context.js');
const { mintToken } = await import('../../src/auth/tokens.js');
const { deleteAccount } = await import('../../src/game/account.js');
const { normalizeInviteCode, generateInviteCode } = await import('../../src/game/invites.js');
const { INVITE_TTL_DAYS, INVITE_CODE_LENGTH } = await import('../../src/game/constants.js');

const DAY_MS = 24 * 60 * 60 * 1000;

describe('invite codes', () => {
  it('are the configured length and avoid look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]+$/);
    }
  });

  it('normalize what people type', () => {
    expect(normalizeInviteCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normalizeInviteCode('ab cd ef gh')).toBe('ABCDEFGH');
  });
});

describe.skipIf(skipIfNoDb)('invites API', () => {
  let env: TestEnv;
  let alice: { userId: string; token: string };
  let bob: { userId: string; token: string };
  let carol: { userId: string; token: string };

  async function user(name: string) {
    const u = await seedUser(env.db, { displayName: name });
    return { userId: u.userId, token: await mintToken(env.db, u.userId) };
  }

  beforeEach(async () => {
    env = await freshDb();
    setDb(env.db);
    dispatchMock.mockClear();
    alice = await user('Alice');
    bob = await user('Bob');
    carol = await user('Carol');
  });

  async function call(who: { token: string } | null, method: 'POST', url: string, payload?: unknown) {
    const app = await buildApp();
    const res = await app.inject({
      method, url, payload: payload as never,
      headers: who ? { authorization: `Bearer ${who.token}` } : {},
    });
    await app.close();
    return res;
  }

  const create = (who: { token: string }, tx = 'tx-create-0001') =>
    call(who, 'POST', '/v1/invites', { client_tx_id: tx });
  const redeem = (who: { token: string }, code: string) =>
    call(who, 'POST', `/v1/invites/${code}/redeem`);

  it('requires authentication', async () => {
    expect((await call(null, 'POST', '/v1/invites', { client_tx_id: 'tx-create-0001' })).statusCode).toBe(401);
    expect((await call(null, 'POST', '/v1/invites/ABCDEFGH/redeem')).statusCode).toBe(401);
  });

  it('creates an invite with a share URL and a 7-day expiry', async () => {
    const res = await create(alice);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toHaveLength(INVITE_CODE_LENGTH);
    expect(body.url).toBe(`https://tilted-server.fly.dev/i/${body.code}`);
    const ttl = new Date(body.expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan((INVITE_TTL_DAYS - 0.01) * DAY_MS);
    expect(ttl).toBeLessThanOrEqual(INVITE_TTL_DAYS * DAY_MS);
  });

  it('create is idempotent on client_tx_id, and distinct ids make distinct invites', async () => {
    const first = (await create(alice, 'tx-same-00001')).json();
    const retry = (await create(alice, 'tx-same-00001')).json();
    const other = (await create(alice, 'tx-other-0001')).json();
    expect(retry).toEqual(first);
    expect(other.code).not.toBe(first.code);
    expect(await env.db.query.invites.findMany()).toHaveLength(2);
  });

  it('rejects a missing client_tx_id', async () => {
    expect((await call(alice, 'POST', '/v1/invites', {})).statusCode).toBe(400);
  });

  it('redeeming starts a match between the two and notifies the inviter', async () => {
    const { code } = (await create(alice)).json();
    const res = await redeem(bob, code);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('active');
    expect(body.opponent).toMatchObject({ user_id: alice.userId, display_name: 'Alice', is_bot: false });
    expect(body.current_round.hands).toHaveLength(10);
    // Redaction: the redeemer never receives the inviter's hole cards.
    for (const h of body.current_round.hands) expect(h.opponent_hole).toBeNull();

    const started = dispatchMock.mock.calls.map(c => c[1] as { kind: string; toUserId: string; fromUserId: string });
    expect(started).toContainEqual(expect.objectContaining({
      kind: 'match_started', toUserId: alice.userId, fromUserId: bob.userId,
    }));

    const row = await env.db.query.invites.findFirst({ where: eq(invites.code, code) });
    expect(row!.redeemedByUserId).toBe(bob.userId);
    expect(row!.matchId).toBe(body.match_id);
  });

  it('accepts the code in lowercase with separators', async () => {
    const { code } = (await create(alice)).json();
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`;
    expect((await redeem(bob, typed)).statusCode).toBe(200);
  });

  it('redeem is idempotent for the same redeemer', async () => {
    const { code } = (await create(alice)).json();
    const first = (await redeem(bob, code)).json();
    const again = await redeem(bob, code);
    expect(again.statusCode).toBe(200);
    expect(again.json().match_id).toBe(first.match_id);
    expect(await env.db.query.matches.findMany()).toHaveLength(1);
  });

  it('is single-use: a second person gets 409 and no match', async () => {
    const { code } = (await create(alice)).json();
    await redeem(bob, code);
    const res = await redeem(carol, code);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('used');
    expect(await env.db.query.matches.findMany()).toHaveLength(1);
  });

  it('two simultaneous redeemers: exactly one match is created', async () => {
    const { code } = (await create(alice)).json();
    const [r1, r2] = await Promise.all([redeem(bob, code), redeem(carol, code)]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect(await env.db.query.matches.findMany()).toHaveLength(1);
  });

  it('refuses your own invite', async () => {
    const { code } = (await create(alice)).json();
    const res = await redeem(alice, code);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('own_invite');
    expect(await env.db.query.matches.findMany()).toHaveLength(0);
  });

  it('refuses an unknown code with 404', async () => {
    const res = await redeem(bob, 'ZZZZZZZZ');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('refuses an expired invite with 410 and leaves it unredeemed', async () => {
    const { code } = (await create(alice)).json();
    await env.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.code, code));
    const res = await redeem(bob, code);
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe('expired');
    const row = await env.db.query.invites.findFirst({ where: eq(invites.code, code) });
    expect(row!.redeemedByUserId).toBeNull();
    expect(await env.db.query.matches.findMany()).toHaveLength(0);
  });

  it('refuses when the pair already has an active match, without consuming the invite', async () => {
    const first = (await create(alice, 'tx-first-00001')).json();
    await redeem(bob, first.code);
    const second = (await create(alice, 'tx-second-0001')).json();
    const res = await redeem(bob, second.code);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('already_playing');
    const row = await env.db.query.invites.findFirst({ where: eq(invites.code, second.code) });
    expect(row!.redeemedByUserId).toBeNull();
    expect(await env.db.query.matches.findMany({ where: eq(matches.status, 'active') })).toHaveLength(1);
  });

  it('an invite from a deleted account stops working', async () => {
    const { code } = (await create(alice)).json();
    await deleteAccount(env.db, alice.userId, 'user_deleted');
    expect((await redeem(bob, code)).statusCode).toBe(404);
    expect(await env.db.query.invites.findMany()).toHaveLength(0);
  });
});

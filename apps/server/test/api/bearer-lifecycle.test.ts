// Bearer tokens must be revocable (sign-out) and must not live forever:
//   - POST /v1/auth/logout deletes the presented token; it stops working
//   - a token unused for longer than TOKEN_IDLE_TTL_DAYS is rejected and removed
//   - use within the window keeps the token alive (sliding expiry)

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser, skipIfNoDb, type TestEnv } from '../integration/helpers.js';
import { debugTokens } from '../../src/db/schema.js';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const { buildApp } = await import('../../src/app.js');
const { setDb } = await import('../../src/api/context.js');
const { mintToken, hashToken, TOKEN_IDLE_TTL_DAYS } = await import('../../src/auth/tokens.js');

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(skipIfNoDb)('bearer token lifecycle', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await freshDb();
    setDb(env.db);
  });

  async function getMe(token: string) {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    await app.close();
    return res;
  }

  it('accepts a freshly minted token', async () => {
    const u = await seedUser(env.db);
    const token = await mintToken(env.db, u.userId);
    expect((await getMe(token)).statusCode).toBe(200);
  });

  it('logout revokes only the presented token', async () => {
    const u = await seedUser(env.db);
    const phone = await mintToken(env.db, u.userId);
    const tablet = await mintToken(env.db, u.userId);

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { authorization: `Bearer ${phone}` } });
    await app.close();
    expect(res.statusCode).toBe(204);

    expect((await getMe(phone)).statusCode).toBe(401);
    expect((await getMe(tablet)).statusCode).toBe(200);
  });

  it('logout requires a bearer', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/auth/logout' });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it('rejects and removes a token idle past the TTL', async () => {
    const u = await seedUser(env.db);
    const token = await mintToken(env.db, u.userId);
    await env.db.update(debugTokens)
      .set({ lastUsedAt: new Date(Date.now() - (TOKEN_IDLE_TTL_DAYS + 1) * DAY_MS) })
      .where(eq(debugTokens.tokenHash, hashToken(token)));

    expect((await getMe(token)).statusCode).toBe(401);
    expect(await env.db.query.debugTokens.findMany()).toHaveLength(0);
  });

  it('use within the window slides the expiry forward', async () => {
    const u = await seedUser(env.db);
    const token = await mintToken(env.db, u.userId);
    const stale = new Date(Date.now() - (TOKEN_IDLE_TTL_DAYS - 1) * DAY_MS);
    await env.db.update(debugTokens).set({ lastUsedAt: stale })
      .where(eq(debugTokens.tokenHash, hashToken(token)));

    expect((await getMe(token)).statusCode).toBe(200);
    const row = await env.db.query.debugTokens.findFirst({ where: eq(debugTokens.tokenHash, hashToken(token)) });
    expect(row!.lastUsedAt.getTime()).toBeGreaterThan(stale.getTime() + DAY_MS);
  });
});

// The public invite landing page and the universal-link association file.
// The page is unauthenticated, so it must reveal only the inviter's first
// name, escape it, and never expose anything for dead or unknown codes.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, seedUser, skipIfNoDb, type TestEnv } from '../integration/helpers.js';
import { invites } from '../../src/db/schema.js';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';
process.env.APNS_TEAM_ID = 'TEAM123456';

vi.mock('../../src/notif/dispatchers.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}));

const { buildApp } = await import('../../src/app.js');
const { setDb } = await import('../../src/api/context.js');
const { createInvite, redeemInvite } = await import('../../src/game/invites.js');
const { escapeHtml } = await import('../../src/web/layout.js');

describe('escapeHtml', () => {
  it('neutralises markup', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  });
});

describe.skipIf(skipIfNoDb)('invite landing page', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await freshDb();
    setDb(env.db);
  });

  async function get(url: string) {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url });
    await app.close();
    return res;
  }

  it('serves the association file for /i/* with the team-prefixed app id', async () => {
    const res = await get('/.well-known/apple-app-site-association');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const details = res.json().applinks.details[0];
    expect(details.appIDs).toEqual(['TEAM123456.com.thomasjjohnston.tilted']);
    expect(details.components[0]['/']).toBe('/i/*');
  });

  it('shows the inviter first name and the code, with no auth and no surname', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice Liddell' });
    const { code } = await createInvite(env.db, alice.userId, 'tx-landing-001');
    const res = await get(`/i/${code}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Alice invited you');
    expect(res.body).toContain(code);
    expect(res.body).not.toContain('Liddell');
    expect(res.body).not.toContain(alice.userId);
    expect(res.body).not.toContain('<script');
  });

  it('escapes a hostile display name', async () => {
    const mallory = await seedUser(env.db, { displayName: '<script>alert(1)</script>' });
    const { code } = await createInvite(env.db, mallory.userId, 'tx-landing-002');
    const res = await get(`/i/${code}`);
    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('unknown code: 404 and a generic message', async () => {
    const res = await get('/i/ZZZZZZZZ');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('isn&#39;t valid');
  });

  it('expired and used invites: 410 and no inviter name', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice Liddell' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const expired = await createInvite(env.db, alice.userId, 'tx-landing-003');
    await env.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.code, expired.code));
    const used = await createInvite(env.db, alice.userId, 'tx-landing-004');
    await redeemInvite(env.db, used.code, bob.userId);

    const e = await get(`/i/${expired.code}`);
    expect(e.statusCode).toBe(410);
    expect(e.body).toContain('expired');
    expect(e.body).not.toContain('Alice');

    const u = await get(`/i/${used.code}`);
    expect(u.statusCode).toBe(410);
    expect(u.body).toContain('already been used');
    expect(u.body).not.toContain('Alice');
  });

  it('viewing the page does not redeem the invite', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const { code } = await createInvite(env.db, alice.userId, 'tx-landing-005');
    await get(`/i/${code}`);
    const row = await env.db.query.invites.findFirst({ where: eq(invites.code, code) });
    expect(row!.redeemedByUserId).toBeNull();
    expect(await env.db.query.matches.findMany()).toHaveLength(0);
  });
});

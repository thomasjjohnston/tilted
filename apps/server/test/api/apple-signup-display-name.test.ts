// First sign-in picks the name opponents will see. A shared Apple name is
// used as-is; a hidden one gets a generated nickname — never "User" and
// never anything derived from the email address.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshDb, skipIfNoDb, type TestEnv } from '../integration/helpers.js';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const verifyMock = vi.fn();
vi.mock('../../src/auth/apple-jwt.js', () => ({
  verifyAppleIdentityToken: (...args: unknown[]) => verifyMock(...args),
}));

const { buildApp } = await import('../../src/app.js');
const { setDb } = await import('../../src/api/context.js');

describe.skipIf(skipIfNoDb)('Apple sign-up display name', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await freshDb();
    setDb(env.db);
    verifyMock.mockReset();
  });

  async function signIn(body: Record<string, unknown>) {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/auth/apple', payload: body });
    await app.close();
    return res;
  }

  it('uses the Apple full name when the user shares it', async () => {
    verifyMock.mockResolvedValue({ sub: 'sub-1', email: 'dana@example.com' });
    const res = await signIn({ identity_token: 'x'.repeat(20), full_name: 'Dana Scully' });
    expect(res.statusCode).toBe(200);
    expect(res.json().display_name).toBe('Dana Scully');
  });

  it('generates a nickname when the name is hidden, not the email prefix', async () => {
    verifyMock.mockResolvedValue({ sub: 'sub-2', email: 'x7k2pq9d@privaterelay.appleid.com' });
    const res = await signIn({ identity_token: 'x'.repeat(20) });
    expect(res.statusCode).toBe(200);
    const name: string = res.json().display_name;
    expect(name).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+){1,2} [1-9]\d?$/);
    expect(name).not.toContain('x7k2pq9d');
    expect(name).not.toBe('User');
  });

  it('keeps the same generated name on later sign-ins', async () => {
    verifyMock.mockResolvedValue({ sub: 'sub-3' });
    const first = (await signIn({ identity_token: 'x'.repeat(20) })).json();
    const second = (await signIn({ identity_token: 'x'.repeat(20) })).json();
    expect(second.user_id).toBe(first.user_id);
    expect(second.display_name).toBe(first.display_name);
  });
});

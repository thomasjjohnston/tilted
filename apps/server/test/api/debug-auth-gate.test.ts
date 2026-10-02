// The debug login route mints a bearer for any user_id with no proof of
// identity. It must only exist when explicitly enabled (local dev stack),
// never by default — production leaves ENABLE_DEBUG_AUTH unset.

import { describe, it, expect } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const { buildApp } = await import('../../src/app.js');

const body = { user_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' };

describe('debug auth gate', () => {
  it('does not register /v1/auth/debug/select by default', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/auth/debug/select', payload: body });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('does not register the route when explicitly disabled', async () => {
    const app = await buildApp({ enableDebugAuth: false });
    const res = await app.inject({ method: 'POST', url: '/v1/auth/debug/select', payload: body });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('registers the route when enabled (malformed body reaches validation)', async () => {
    const app = await buildApp({ enableDebugAuth: true });
    const res = await app.inject({ method: 'POST', url: '/v1/auth/debug/select', payload: { user_id: 'nope' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// The App Store listing links to these; they must exist, be public, and
// name the real contact address.

import { describe, it, expect } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const { buildApp } = await import('../../src/app.js');

describe('public pages', () => {
  for (const [url, heading] of [['/privacy', 'Privacy policy'], ['/support', 'Tilted support']] as const) {
    it(`${url} is served without auth as HTML`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url });
      await app.close();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain(heading);
      expect(res.body).toContain('tilted.admin@gmail.com');
      expect(res.body).not.toContain('tilted.app');
      expect(res.body).not.toContain('<script');
    });
  }

  it('the policy mentions deletion, Sign in with Apple and no real money', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/privacy' });
    await app.close();
    expect(res.body).toContain('Delete Account');
    expect(res.body).toContain('sign in with Apple');
    expect(res.body).toContain('no real-money');
  });
});

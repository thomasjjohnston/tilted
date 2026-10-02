import type { FastifyInstance } from 'fastify';
import { page } from '../../web/layout.js';
import { PRIVACY_POLICY_HTML, PRIVACY_POLICY_UPDATED } from '../../web/privacy-policy.js';
import { SUPPORT_HTML } from '../../web/support.js';

/**
 * Static public pages required for the App Store listing: the privacy
 * policy and the support page. Plain HTML from the server so they live
 * with the code that makes them true.
 */
export async function webPageRoutes(app: FastifyInstance) {
  app.get('/privacy', async (_req, reply) => {
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send(page('Tilted privacy policy', PRIVACY_POLICY_HTML));
  });

  app.get('/support', async (_req, reply) => {
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send(page('Tilted support', SUPPORT_HTML));
  });

  // Plain-text mirror of the policy date, handy for checking deploys.
  app.get('/privacy/version', async () => ({ updated: PRIVACY_POLICY_UPDATED }));
}

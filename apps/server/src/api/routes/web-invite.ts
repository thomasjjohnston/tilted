import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { getDb } from '../context.js';
import { env } from '../../env.js';
import { getInvitePreview, normalizeInviteCode } from '../../game/invites.js';
import { escapeHtml, page } from '../../web/layout.js';

/**
 * Public, unauthenticated web routes behind an invite link:
 *
 *   GET /i/:code — the page a friend lands on when they don't have the app
 *     (with the app installed, iOS opens the app instead via the universal
 *     link and this never renders).
 *   GET /.well-known/apple-app-site-association — tells iOS that /i/* links
 *     on this host belong to the app.
 */
export async function webInviteRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });

  app.get('/.well-known/apple-app-site-association', async (_req, reply) => {
    if (!env.APNS_TEAM_ID) return reply.status(404).send({ error: 'Not configured' });
    return reply.type('application/json').send({
      applinks: {
        details: [{
          appIDs: [`${env.APNS_TEAM_ID}.${env.APNS_BUNDLE_ID}`],
          components: [{ '/': '/i/*', comment: 'Invite links' }],
        }],
      },
    });
  });

  app.get('/i/:code', async (req, reply) => {
    const code = normalizeInviteCode((req.params as { code: string }).code).slice(0, 40);
    const preview = await getInvitePreview(getDb(), code);
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');

    if (preview.status !== 'open') {
      const reason = preview.status === 'expired'
        ? 'This invite has expired.'
        : preview.status === 'used'
          ? 'This invite has already been used.'
          : 'This invite link isn\'t valid.';
      return reply.status(preview.status === 'not_found' ? 404 : 410).send(page('Tilted invite', `
<h1>${escapeHtml(reason)}</h1>
<p>Ask your friend to send a new one from the Tilted app.</p>
${installBlock()}`));
    }

    const name = escapeHtml(preview.inviterFirstName);
    return reply.send(page(`${preview.inviterFirstName} invited you to Tilted`, `
<h1>${name} invited you to a game of Tilted.</h1>
<p>Heads-up poker with friends: ten hands at once, one shared stack. No real money.</p>
${installBlock()}
<ol>
  <li>Install Tilted and sign in.</li>
  <li>Tap this link again, or choose <strong>Enter invite code</strong> and type:</li>
</ol>
<div class="code">${escapeHtml(code)}</div>
<small>The invite works once and expires on ${escapeHtml(preview.expiresOn)}.</small>`));
  });
}

function installBlock(): string {
  return env.APP_STORE_URL
    ? `<a class="button" href="${escapeHtml(env.APP_STORE_URL)}">Get Tilted on the App Store</a>`
    : '<p><strong>Tilted for iPhone is coming to the App Store soon.</strong></p>';
}

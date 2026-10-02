import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../context.js';
import { users } from '../../db/schema.js';
import { env } from '../../env.js';
import { verifyAppleIdentityToken } from '../../auth/apple-jwt.js';
import { deleteAccount } from '../../game/account.js';

const bodySchema = z.object({
  payload: z.string().min(10),
});

/**
 * Apple server-to-server notification handler. Apple POSTs a signed
 * JWT whenever a user revokes consent, deletes their Apple ID
 * account-binding with our app, or changes their email.
 *
 * Setup is manual, outside the code:
 * 1. Create a Service ID in Apple Developer portal.
 * 2. Configure this URL (e.g. https://tilted-server.fly.dev/v1/auth/apple/notifications)
 *    as the Return URL for the service.
 * 3. Until configured, Apple never calls this; the endpoint is a no-op.
 */
export async function authAppleWebhookRoutes(app: FastifyInstance) {
  app.post('/auth/apple/notifications', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body' });
    }

    let verified;
    try {
      verified = await verifyAppleIdentityToken(parsed.data.payload, env.APNS_BUNDLE_ID);
    } catch (err) {
      return reply.status(401).send({ error: 'Invalid Apple token', detail: (err as Error).message });
    }

    // The events claim is a stringified JSON with { type, sub, event_time, ... }.
    // verifyAppleIdentityToken only exposes sub + email; re-parse the payload
    // to grab `events`.
    const parts = parsed.data.payload.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      events?: string;
    };
    let parsedEvents: { type?: string; sub?: string } = {};
    try {
      parsedEvents = JSON.parse(claims.events ?? '{}') as { type?: string; sub?: string };
    } catch {
      // If events doesn't parse, we still 200 — Apple retries if we 5xx.
      return { ok: true };
    }

    const eventType = parsedEvents.type;
    const eventSub = parsedEvents.sub ?? verified.sub;

    const db = getDb();

    if (eventType === 'account-delete' || eventType === 'consent-revoked') {
      const user = await db.query.users.findFirst({ where: eq(users.appleSub, eventSub) });
      if (user) {
        await deleteAccount(db, user.userId, 'user_deleted_by_apple', { type: eventType });
      }
    }

    // For email-update / email-disabled we could update the row, but Apple
    // usually sends these along with existing sign-in flows anyway. Not
    // worth the complexity for MVP.

    return { ok: true };
  });
}

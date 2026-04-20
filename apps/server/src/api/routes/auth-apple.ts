import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../context.js';
import { users, debugTokens } from '../../db/schema.js';
import { env } from '../../env.js';
import { verifyAppleIdentityToken } from '../../auth/apple-jwt.js';
import { logEvent } from '../../events/logger.js';

const bodySchema = z.object({
  identity_token: z.string().min(10),
  full_name: z.string().max(200).optional(),
  email: z.string().email().max(200).optional(),
});

export async function authAppleRoutes(app: FastifyInstance) {
  app.post('/auth/apple', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: parsed.error.issues });
    }
    const { identity_token, full_name, email: bodyEmail } = parsed.data;

    let identity;
    try {
      identity = await verifyAppleIdentityToken(identity_token, env.APNS_BUNDLE_ID);
    } catch (err) {
      return reply.status(401).send({ error: 'Invalid Apple identity token', detail: (err as Error).message });
    }

    const db = getDb();

    // Prefer the email Apple signed into the token over whatever the client
    // claimed; only fall back to the body on subsequent sign-ins when the
    // token no longer carries it.
    const effectiveEmail = identity.email ?? bodyEmail ?? null;
    const effectiveFullName = full_name ?? null;

    // Upsert by apple_sub.
    let user = await db.query.users.findFirst({
      where: eq(users.appleSub, identity.sub),
    });

    if (!user) {
      const displayName = effectiveFullName
        || (effectiveEmail ? effectiveEmail.split('@')[0] : null)
        || 'User';

      const [inserted] = await db.insert(users).values({
        appleSub: identity.sub,
        email: effectiveEmail,
        fullName: effectiveFullName,
        displayName,
      }).returning();
      user = inserted;

      await logEvent(db, user.userId, 'user_signed_up', { via: 'apple' });
    } else {
      // Only backfill fields the token actually provided. Apple sends
      // name/email only on first sign-in per account; don't overwrite with null.
      const updates: Partial<typeof users.$inferInsert> = {};
      if (!user.email && effectiveEmail) updates.email = effectiveEmail;
      if (!user.fullName && effectiveFullName) updates.fullName = effectiveFullName;
      if (Object.keys(updates).length > 0) {
        await db.update(users).set(updates).where(eq(users.userId, user.userId));
        user = { ...user, ...updates } as typeof user;
      }

      await logEvent(db, user.userId, 'user_signed_in', { via: 'apple' });
    }

    // Mint a bearer token
    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    await db.insert(debugTokens).values({
      tokenHash: hash,
      userId: user.userId,
    });

    return {
      token,
      user_id: user.userId,
      display_name: user.displayName,
    };
  });
}

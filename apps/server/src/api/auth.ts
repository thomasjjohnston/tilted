import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from './context.js';
import { debugTokens, users } from '../db/schema.js';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

/**
 * Debug auth routes (no bearer token required).
 * POST /auth/debug/select — pick a user, get a token.
 */
export async function debugAuthRoutes(app: FastifyInstance) {
  const selectBody = z.object({ user_id: z.string().uuid() });

  app.post('/auth/debug/select', async (req, reply) => {
    const { user_id } = selectBody.parse(req.body);
    const db = getDb();

    const user = await db.query.users.findFirst({
      where: eq(users.userId, user_id),
    });
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const token = randomBytes(32).toString('hex');
    const hash = hashToken(token);

    await db.insert(debugTokens).values({
      tokenHash: hash,
      userId: user_id,
    });

    return { token, user_id, display_name: user.displayName };
  });
}

/**
 * Bearer auth hook — verifies the token and sets req.userId.
 * Used as an onRequest hook for authenticated routes.
 */
export async function bearerAuth(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing bearer token' });
  }

  const token = authHeader.slice(7);
  const hash = hashToken(token);
  const db = getDb();

  const row = await db.query.debugTokens.findFirst({
    where: eq(debugTokens.tokenHash, hash),
  });

  if (!row) {
    return reply.status(401).send({ error: 'Invalid token' });
  }

  req.userId = row.userId;
}

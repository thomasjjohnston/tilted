import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from './context.js';
import { users } from '../db/schema.js';
import { mintToken, resolveToken, revokeToken } from '../auth/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    tokenHash: string;
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

    const token = await mintToken(db, user_id);

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

  const resolved = await resolveToken(getDb(), authHeader.slice(7));
  if (!resolved) {
    return reply.status(401).send({ error: 'Invalid token' });
  }

  req.userId = resolved.userId;
  req.tokenHash = resolved.tokenHash;
}

/**
 * Authenticated session routes.
 * POST /auth/logout — revoke the presented bearer (sign-out on this device).
 */
export async function sessionRoutes(app: FastifyInstance) {
  app.post('/auth/logout', async (req, reply) => {
    await revokeToken(getDb(), req.tokenHash);
    return reply.status(204).send();
  });
}

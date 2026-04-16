import type { FastifyInstance, FastifyRequest } from 'fastify';
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

export async function authPlugin(app: FastifyInstance) {
  // Debug auth: select user → get token
  const selectBody = z.object({ user_id: z.string().uuid() });

  app.post('/auth/debug/select', async (req, reply) => {
    const { user_id } = selectBody.parse(req.body);
    const db = getDb();

    // Verify user exists
    const user = await db.query.users.findFirst({
      where: eq(users.userId, user_id),
    });
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    // Generate token
    const token = randomBytes(32).toString('hex');
    const hash = hashToken(token);

    await db.insert(debugTokens).values({
      tokenHash: hash,
      userId: user_id,
    });

    return { token, user_id, display_name: user.displayName };
  });

  // Bearer auth middleware for all other /v1/* routes
  app.addHook('onRequest', async (req: FastifyRequest, reply) => {
    // Skip auth for debug routes
    if (req.url.startsWith('/v1/auth/')) return;

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
  });
}

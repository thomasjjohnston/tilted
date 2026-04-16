import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../context.js';
import { users } from '../../db/schema.js';

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    const db = getDb();
    const user = await db.query.users.findFirst({
      where: eq(users.userId, req.userId),
    });
    return {
      user_id: user!.userId,
      display_name: user!.displayName,
      apns_token: user!.apnsToken,
    };
  });

  const apnsBody = z.object({ apns_token: z.string() });

  app.post('/me/apns-token', async (req, reply) => {
    const { apns_token } = apnsBody.parse(req.body);
    const db = getDb();
    await db.update(users)
      .set({ apnsToken: apns_token })
      .where(eq(users.userId, req.userId));
    return reply.status(204).send();
  });
}

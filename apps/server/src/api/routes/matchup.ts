import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, or, eq, desc } from 'drizzle-orm';
import { getDb } from '../context.js';
import { getMatchUp } from '../../game/matchup.js';
import { matches } from '../../db/schema.js';

const querySchema = z.object({
  opponent_user_id: z.string().uuid().optional(),
});

export async function matchupRoutes(app: FastifyInstance) {
  app.get('/matchup', async (req, reply) => {
    const parsed = querySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    }

    const db = getDb();
    let opponentId = parsed.data.opponent_user_id;

    // Back-compat: if the client omitted opponent_user_id, pick the most
    // recently-played opponent. If there's no history, 404.
    if (!opponentId) {
      const recent = await db.query.matches.findFirst({
        where: or(eq(matches.userAId, req.userId), eq(matches.userBId, req.userId)),
        orderBy: desc(matches.startedAt),
      });
      if (!recent) {
        return reply.status(404).send({ error: 'No opponent specified and no history' });
      }
      opponentId = recent.userAId === req.userId ? recent.userBId : recent.userAId;
    }

    return getMatchUp(db, req.userId, opponentId);
  });
}

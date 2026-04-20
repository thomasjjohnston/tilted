import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../context.js';
import {
  createMatch,
  getCurrentMatch,
  getMatchState,
  listActiveMatches,
} from '../../game/match.js';

const createBody = z.object({ opponent_user_id: z.string().uuid() });

export async function matchRoutes(app: FastifyInstance) {
  // Back-compat: single current match (returns most recent if more than one)
  app.get('/match/current', async (req) => {
    const db = getDb();
    return getCurrentMatch(db, req.userId);
  });

  // List every active match the user is in
  app.get('/matches', async (req) => {
    const db = getDb();
    return listActiveMatches(db, req.userId);
  });

  // Start a new match. Body: { opponent_user_id }
  app.post('/match', async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: parsed.error.issues });
    }
    const db = getDb();
    const match = await createMatch(db, req.userId, parsed.data.opponent_user_id);
    return getMatchState(db, match.matchId, req.userId);
  });
}

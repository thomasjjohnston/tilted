import type { FastifyInstance } from 'fastify';
import { getDb } from '../context.js';
import { createMatch, getCurrentMatch, getMatchState } from '../../game/match.js';

export async function matchRoutes(app: FastifyInstance) {
  // Get current active match (user-scoped view)
  app.get('/match/current', async (req) => {
    const db = getDb();
    const match = await getCurrentMatch(db, req.userId);
    return match;
  });

  // Start a new match
  app.post('/match', async (req) => {
    const db = getDb();
    const match = await createMatch(db, req.userId);
    return getMatchState(db, match.matchId, req.userId);
  });
}

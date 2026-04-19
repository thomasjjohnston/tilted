import type { FastifyInstance } from 'fastify';
import { getDb } from '../context.js';
import { getMatchUp } from '../../game/matchup.js';

export async function matchupRoutes(app: FastifyInstance) {
  app.get('/matchup', async (req) => {
    const db = getDb();
    return getMatchUp(db, req.userId);
  });
}

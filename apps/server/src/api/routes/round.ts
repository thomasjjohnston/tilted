import type { FastifyInstance } from 'fastify';
import { getDb } from '../context.js';
import { advanceRound } from '../../game/round.js';

export async function roundRoutes(app: FastifyInstance) {
  // Advance to next round (after reveal)
  app.post('/round/:roundId/advance', async (req) => {
    const { roundId } = req.params as { roundId: string };
    const db = getDb();
    return advanceRound(db, roundId, req.userId);
  });
}

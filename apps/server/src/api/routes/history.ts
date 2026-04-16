import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../context.js';
import { getHistory } from '../../game/history.js';

const historyQuery = z.object({
  favorites: z.enum(['true', 'false']).optional(),
  result: z.enum(['won', 'lost', 'all']).optional(),
  round: z.coerce.number().int().optional(),
  match_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export async function historyRoutes(app: FastifyInstance) {
  app.get('/history', async (req) => {
    const query = historyQuery.parse(req.query);
    const db = getDb();
    return getHistory(db, req.userId, {
      favoritesOnly: query.favorites === 'true',
      result: query.result ?? 'all',
      roundIndex: query.round,
      matchId: query.match_id,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
  });

  app.get('/match/:matchId/history', async (req) => {
    const { matchId } = req.params as { matchId: string };
    const query = historyQuery.parse(req.query);
    const db = getDb();
    return getHistory(db, req.userId, {
      matchId,
      favoritesOnly: query.favorites === 'true',
      result: query.result ?? 'all',
      roundIndex: query.round,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
  });
}

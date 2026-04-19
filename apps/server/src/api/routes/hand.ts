import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../context.js';
import { applyAction, applyBatchActions, getLegalActions } from '../../game/turn.js';
import { getHandDetail } from '../../game/hand.js';
import { toggleFavorite } from '../../game/favorites.js';

const actionBody = z.object({
  type: z.enum(['fold', 'check', 'call', 'bet', 'raise', 'all_in']),
  amount: z.number().int().nonnegative().optional(),
  client_tx_id: z.string().min(1),
  client_sent_at: z.string().datetime().optional(),
});

const batchActionBody = z.object({
  actions: z.array(z.object({
    hand_id: z.string().uuid(),
    type: z.enum(['fold', 'check', 'call', 'bet', 'raise', 'all_in']),
    amount: z.number().int().nonnegative().optional(),
    client_tx_id: z.string().min(1),
  })),
});

const favoriteBody = z.object({
  favorite: z.boolean(),
});

export async function handRoutes(app: FastifyInstance) {
  // Apply an action to a hand
  app.post('/hand/:handId/action', async (req, reply) => {
    const { handId } = req.params as { handId: string };
    const body = actionBody.parse(req.body);
    const db = getDb();

    const result = await applyAction(db, {
      handId,
      userId: req.userId,
      actionType: body.type,
      amount: body.amount ?? 0,
      clientTxId: body.client_tx_id,
      clientSentAt: body.client_sent_at ? new Date(body.client_sent_at) : undefined,
    });

    return result;
  });

  // Batch apply actions to multiple hands in a single transaction
  app.post('/batch-actions', async (req) => {
    const { actions } = batchActionBody.parse(req.body);
    const db = getDb();

    return applyBatchActions(db, req.userId, actions.map(a => ({
      handId: a.hand_id,
      actionType: a.type,
      amount: a.amount ?? 0,
      clientTxId: a.client_tx_id,
    })));
  });

  // Get legal actions for a hand
  app.get('/hand/:handId/legal-actions', async (req) => {
    const { handId } = req.params as { handId: string };
    const db = getDb();
    return getLegalActions(db, handId, req.userId);
  });

  // Get full hand detail (for replay)
  app.get('/hand/:handId', async (req) => {
    const { handId } = req.params as { handId: string };
    const db = getDb();
    return getHandDetail(db, handId, req.userId);
  });

  // Toggle favorite
  app.post('/hand/:handId/favorite', async (req, reply) => {
    const { handId } = req.params as { handId: string };
    const { favorite } = favoriteBody.parse(req.body);
    const db = getDb();
    await toggleFavorite(db, req.userId, handId, favorite);
    return reply.status(204).send();
  });
}

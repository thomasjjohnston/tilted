import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../context.js';
import { applyTurnBatch } from '../../game/turn.js';

const turnSubmitBody = z.object({
  round_id: z.string().uuid().optional(),
  turn_tx_id: z.string().min(1).optional(),
  actions: z.array(z.object({
    hand_id: z.string().uuid(),
    type: z.enum(['fold', 'check', 'call', 'bet', 'raise', 'all_in']),
    amount: z.number().int().nonnegative().optional(),
    client_tx_id: z.string().min(1),
  })).min(1),
});

export async function turnRoutes(app: FastifyInstance) {
  // Submit a whole turn as one all-or-nothing batch (the cart, spec §6).
  app.post('/turn/submit', async (req) => {
    const body = turnSubmitBody.parse(req.body);
    const db = getDb();

    return applyTurnBatch(db, req.userId, {
      roundId: body.round_id,
      turnTxId: body.turn_tx_id,
      actions: body.actions.map(a => ({
        handId: a.hand_id,
        actionType: a.type,
        amount: a.amount ?? 0,
        clientTxId: a.client_tx_id,
      })),
    });
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../context.js';
import { BlockNotAllowedError, blockUser, listBlocked, unblockUser } from '../../game/blocks.js';
import { OpponentNotFoundError } from '../../game/match.js';

const blockBody = z.object({ user_id: z.string().uuid() });
const unblockParams = z.object({ userId: z.string().uuid() });

export async function blockRoutes(app: FastifyInstance) {
  // Players the caller has blocked.
  app.get('/blocks', async (req) => listBlocked(getDb(), req.userId));

  // Block a player. Naturally idempotent (keyed on the pair), so no
  // client_tx_id is needed: a retry is a no-op.
  app.post('/blocks', async (req, reply) => {
    const { user_id } = blockBody.parse(req.body);
    try {
      await blockUser(getDb(), req.userId, user_id);
    } catch (e) {
      if (e instanceof BlockNotAllowedError) {
        return reply.status(400).send({ error: e.message });
      }
      if (e instanceof OpponentNotFoundError) {
        return reply.status(404).send({ error: e.message });
      }
      throw e;
    }
    return reply.status(204).send();
  });

  // Unblock. Idempotent.
  app.delete('/blocks/:userId', async (req, reply) => {
    const { userId } = unblockParams.parse(req.params);
    await unblockUser(getDb(), req.userId, userId);
    return reply.status(204).send();
  });
}

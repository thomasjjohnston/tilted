import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { getDb } from '../context.js';
import { InviteError, createInvite, redeemInvite, type InviteErrorCode } from '../../game/invites.js';
import { getMatchState } from '../../game/match.js';

const createBody = z.object({ client_tx_id: z.string().min(8).max(100) });
const codeParams = z.object({ code: z.string().min(1).max(40) });

const STATUS_FOR: Record<InviteErrorCode, number> = {
  not_found: 404,
  expired: 410,
  used: 409,
  own_invite: 409,
  already_playing: 409,
};

export async function inviteRoutes(app: FastifyInstance) {
  // Codes are short enough to type, so cap guessing per user.
  await app.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: req => req.userId || req.ip,
  });

  // Create a single-use invite to share. Idempotent on client_tx_id.
  app.post('/invites', async (req) => {
    const { client_tx_id } = createBody.parse(req.body);
    return createInvite(getDb(), req.userId, client_tx_id);
  });

  // Redeem an invite: starts the match and returns its state.
  app.post('/invites/:code/redeem', async (req, reply) => {
    const { code } = codeParams.parse(req.params);
    const db = getDb();
    try {
      const { matchId } = await redeemInvite(db, code, req.userId);
      return await getMatchState(db, matchId, req.userId);
    } catch (e) {
      if (e instanceof InviteError) {
        return reply.status(STATUS_FOR[e.code]).send({ error: e.code, message: e.message });
      }
      throw e;
    }
  });
}

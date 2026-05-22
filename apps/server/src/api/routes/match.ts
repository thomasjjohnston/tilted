import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../context.js';
import {
  createMatch,
  getCurrentMatch,
  getMatchState,
  listActiveMatches,
  sendPing,
} from '../../game/match.js';
import { sendMessage, listMessages } from '../../game/messages.js';

const createBody = z.object({ opponent_user_id: z.string().uuid() });

const messageBody = z.object({
  body: z.string().min(1).max(500),
  hand_id: z.string().uuid().optional(),
});

const messageListQuery = z.object({
  hand_id: z.string().uuid().optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

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

  // Ping the opponent — fires an APNS push with a random poker quip.
  app.post('/match/:matchId/ping', async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    try {
      return await sendPing(getDb(), matchId, req.userId);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'Not a participant') {
        return reply.status(403).send({ error: msg });
      }
      if (msg === 'Match not found' || msg === 'Match is not active') {
        return reply.status(404).send({ error: msg });
      }
      throw e;
    }
  });

  // Send a chat message. Optional hand_id scopes it to the per-hand sidebar.
  app.post('/match/:matchId/messages', async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const parsed = messageBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      return await sendMessage(getDb(), matchId, req.userId, parsed.data.body, parsed.data.hand_id);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'Not a participant') return reply.status(403).send({ error: msg });
      if (msg === 'Match not found') return reply.status(404).send({ error: msg });
      throw e;
    }
  });

  // List chat messages. ?hand_id filters to the per-hand sidebar; omitted
  // returns the full match thread (which includes hand-scoped messages).
  app.get('/match/:matchId/messages', async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const parsed = messageListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues });
    }
    try {
      const items = await listMessages(getDb(), matchId, req.userId, {
        handId: parsed.data.hand_id,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
      });
      return { messages: items };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'Not a participant') return reply.status(403).send({ error: msg });
      if (msg === 'Match not found') return reply.status(404).send({ error: msg });
      throw e;
    }
  });
}

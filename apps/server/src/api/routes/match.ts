import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../context.js';
import { BotUnavailableError, getPlayableBot } from '../../game/bot.js';
import {
  MatchAlreadyActiveError,
  OpponentNotFoundError,
  createMatch,
  createRematch,
  listOpponents,
  getCurrentMatch,
  getMatchState,
  listActiveMatches,
  sendPing,
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

  // Rematch someone you have played before. Body: { opponent_user_id }.
  // New opponents come through invites; the bot through /match/bot.
  app.post('/match', async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: parsed.error.issues });
    }
    const db = getDb();
    try {
      const match = await createRematch(db, req.userId, parsed.data.opponent_user_id);
      return await getMatchState(db, match.matchId, req.userId);
    } catch (e) {
      if (e instanceof OpponentNotFoundError) {
        return reply.status(404).send({ error: e.message });
      }
      if (e instanceof MatchAlreadyActiveError) {
        return reply.status(409).send({ error: e.message });
      }
      throw e;
    }
  });

  // People you have played before: the rematch list.
  app.get('/opponents', async (req) => listOpponents(getDb(), req.userId));

  // Whether "Play Untilted" should be offered to this user right now.
  app.get('/bot', async (req) => {
    const bot = await getPlayableBot(getDb(), req.userId);
    return bot
      ? { available: true, user_id: bot.userId, display_name: bot.displayName }
      : { available: false };
  });

  // Start a match against the bot. No body: the server picks the opponent.
  app.post('/match/bot', async (req, reply) => {
    const db = getDb();
    const bot = await getPlayableBot(db, req.userId);
    if (!bot) return reply.status(503).send({ error: 'Bot unavailable' });
    try {
      const match = await createMatch(db, req.userId, bot.userId);
      return await getMatchState(db, match.matchId, req.userId);
    } catch (e) {
      if (e instanceof MatchAlreadyActiveError) {
        return reply.status(409).send({ error: e.message });
      }
      if (e instanceof BotUnavailableError) {
        return reply.status(503).send({ error: e.message });
      }
      throw e;
    }
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
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { getDb } from '../context.js';
import {
  users, matches, rounds, hands, actions, favorites,
  turnHandoffs, pendingReminders, debugTokens,
} from '../../db/schema.js';
import { logEvent } from '../../events/logger.js';

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    const db = getDb();
    const user = await db.query.users.findFirst({
      where: eq(users.userId, req.userId),
    });
    return {
      user_id: user!.userId,
      display_name: user!.displayName,
      apns_token: user!.apnsToken,
    };
  });

  const apnsBody = z.object({ apns_token: z.string() });

  app.post('/me/apns-token', async (req, reply) => {
    const { apns_token } = apnsBody.parse(req.body);
    const db = getDb();
    await db.update(users)
      .set({ apnsToken: apns_token })
      .where(eq(users.userId, req.userId));
    return reply.status(204).send();
  });

  /**
   * Delete the requesting user's account and all owned data.
   * Required by App Store Guideline 5.1.1(v) for apps offering
   * Sign in with Apple.
   *
   * Deletes in FK-safe order: actions+favorites → hands →
   * turn_handoffs → pending_reminders (round-scoped) → rounds →
   * pending_reminders (match-scoped) → matches → debug_tokens → users.
   */
  app.delete('/me', async (req) => {
    const db = getDb();
    const userId = req.userId;

    await db.transaction(async (tx) => {
      const userMatches = await tx.query.matches.findMany({
        where: or(eq(matches.userAId, userId), eq(matches.userBId, userId)),
      });

      for (const m of userMatches) {
        const matchRounds = await tx.query.rounds.findMany({
          where: eq(rounds.matchId, m.matchId),
        });
        for (const r of matchRounds) {
          const roundHands = await tx.query.hands.findMany({
            where: eq(hands.roundId, r.roundId),
          });
          for (const h of roundHands) {
            await tx.delete(actions).where(eq(actions.handId, h.handId));
            await tx.delete(favorites).where(eq(favorites.handId, h.handId));
          }
          await tx.delete(turnHandoffs).where(eq(turnHandoffs.roundId, r.roundId));
          await tx.delete(pendingReminders).where(eq(pendingReminders.roundId, r.roundId));
          await tx.delete(hands).where(eq(hands.roundId, r.roundId));
        }
        await tx.delete(pendingReminders).where(eq(pendingReminders.matchId, m.matchId));
        await tx.delete(rounds).where(eq(rounds.matchId, m.matchId));
      }

      await tx.delete(matches).where(
        or(eq(matches.userAId, userId), eq(matches.userBId, userId))
      );
      await tx.delete(debugTokens).where(eq(debugTokens.userId, userId));

      await logEvent(tx, userId, 'user_deleted', {});
      await tx.delete(users).where(eq(users.userId, userId));
    });

    return { ok: true };
  });
}

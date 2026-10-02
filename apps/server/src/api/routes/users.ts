import type { FastifyInstance } from 'fastify';
import { getDb } from '../context.js';
import { listOpponents } from '../../game/match.js';

export async function usersRoutes(app: FastifyInstance) {
  /**
   * Deprecated: kept so app builds from before invites (≤ 0.1.7) can still
   * open their opponent picker. It used to return every user; it now
   * returns the same list as GET /v1/opponents — people the caller has
   * already played — so strangers are never exposed. Remove once no old
   * build is in use.
   */
  app.get('/users', async (req) => {
    const opponents = await listOpponents(getDb(), req.userId);
    return opponents.map(o => ({
      user_id: o.user_id,
      display_name: o.display_name,
      initials: o.initials,
      is_bot: false,
    }));
  });
}

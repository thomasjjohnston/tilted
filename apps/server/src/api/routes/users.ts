import type { FastifyInstance } from 'fastify';
import { ne, asc } from 'drizzle-orm';
import { getDb } from '../context.js';
import { users } from '../../db/schema.js';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(s => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export async function usersRoutes(app: FastifyInstance) {
  /**
   * Public roster for the opponent picker. Excludes the requesting user.
   * Only returns fields that are safe for every user to see about every
   * other user: id, display name, initials. No email, no apple_sub, no
   * APNS token.
   */
  app.get('/users', async (req) => {
    const db = getDb();
    const rows = await db.query.users.findMany({
      where: ne(users.userId, req.userId),
      orderBy: asc(users.displayName),
    });
    return rows.map(u => ({
      user_id: u.userId,
      display_name: u.displayName,
      initials: initials(u.displayName),
    }));
  });
}

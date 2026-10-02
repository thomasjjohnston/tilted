import { and, eq, or, sql } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { blocks, matches, users } from '../db/schema.js';
import { logEvent } from '../events/logger.js';
import { OpponentNotFoundError, abandonMatchesTx, initialsOf } from './match.js';

/** The request itself is malformed for blocking (yourself, or the bot). */
export class BlockNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockNotAllowedError';
  }
}

export interface BlockedView {
  user_id: string;
  display_name: string;
  initials: string;
  blocked_at: string;
}

/**
 * Block a player you have played (spec §27). Ends the pair's active match
 * as abandoned in the same transaction. Idempotent: blocking twice is a
 * no-op. The blocked player gets no notification.
 */
export async function blockUser(db: Database, blockerId: string, targetId: string): Promise<void> {
  if (blockerId === targetId) throw new BlockNotAllowedError('You cannot block yourself');

  await db.transaction(async (tx) => {
    const target = await tx.query.users.findFirst({ where: eq(users.userId, targetId) });
    if (!target) throw new OpponentNotFoundError();
    if (target.isBot) throw new BlockNotAllowedError('The bot cannot be blocked');

    // Only people you have a match with: blocking must not confirm that an
    // arbitrary user id exists.
    const shared = await tx.query.matches.findFirst({
      where: or(
        and(eq(matches.userAId, blockerId), eq(matches.userBId, targetId)),
        and(eq(matches.userAId, targetId), eq(matches.userBId, blockerId)),
      ),
    });
    if (!shared) throw new OpponentNotFoundError();

    // Lock the pair's active match (if any) before changing anything, so
    // this serializes against an in-flight turn (HLD §6).
    const active = await tx.execute<{ match_id: string }>(sql`
      SELECT match_id FROM matches
      WHERE status = 'active'
        AND ((user_a_id = ${blockerId} AND user_b_id = ${targetId})
          OR (user_a_id = ${targetId} AND user_b_id = ${blockerId}))
      ORDER BY match_id
      FOR UPDATE
    `);

    const inserted = await tx.insert(blocks)
      .values({ blockerUserId: blockerId, blockedUserId: targetId })
      .onConflictDoNothing()
      .returning();

    await abandonMatchesTx(tx, active.map(r => r.match_id));

    if (inserted.length > 0) {
      await logEvent(tx, blockerId, 'user_blocked', {
        blocked_user_id: targetId,
        abandoned_matches: active.length,
      });
    }
  });
}

/** Lift your own block. Idempotent; does not revive an abandoned match. */
export async function unblockUser(db: Database, blockerId: string, targetId: string): Promise<void> {
  const removed = await db.delete(blocks)
    .where(and(eq(blocks.blockerUserId, blockerId), eq(blocks.blockedUserId, targetId)))
    .returning();
  if (removed.length > 0) {
    await logEvent(db, blockerId, 'user_unblocked', { blocked_user_id: targetId });
  }
}

/** The players this user has blocked, newest first. */
export async function listBlocked(db: Database, blockerId: string): Promise<BlockedView[]> {
  const rows = await db
    .select({ userId: users.userId, displayName: users.displayName, createdAt: blocks.createdAt })
    .from(blocks)
    .innerJoin(users, eq(users.userId, blocks.blockedUserId))
    .where(eq(blocks.blockerUserId, blockerId))
    .orderBy(sql`${blocks.createdAt} DESC`);
  return rows.map(r => ({
    user_id: r.userId,
    display_name: r.displayName,
    initials: initialsOf(r.displayName),
    blocked_at: r.createdAt.toISOString(),
  }));
}

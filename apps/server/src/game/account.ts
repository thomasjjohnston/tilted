import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { users, blocks, favorites, invites, pendingReminders, debugTokens } from '../db/schema.js';
import { abandonMatchesTx } from './match.js';
import { logEvent } from '../events/logger.js';

/** What opponents see in place of a deleted player's name. */
export const DELETED_DISPLAY_NAME = 'Deleted Player';

/**
 * Delete a user's account (spec §23, App Store Guideline 5.1.1(v)).
 *
 * The user's personal data goes: Apple binding, email, name, push token,
 * bearer tokens and pinned hands. The user row itself is scrubbed and
 * kept, and every match, round, hand and action stays, so the other
 * player's history is not destroyed by someone else's deletion. Active
 * matches end as 'abandoned' with no winner.
 *
 * Idempotent: deleting an already-deleted (or unknown) user is a no-op.
 */
export async function deleteAccount(
  db: Database,
  userId: string,
  eventKind: 'user_deleted' | 'user_deleted_by_apple',
  eventPayload: Record<string, unknown> = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const user = await tx.query.users.findFirst({ where: eq(users.userId, userId) });
    if (!user || user.deletedAt) return;

    // Lock every active match the user is in, in a stable order, before
    // changing anything — serializes against in-flight turns (HLD §6).
    const active = await tx.execute<{ match_id: string }>(sql`
      SELECT match_id FROM matches
      WHERE status = 'active' AND (user_a_id = ${userId} OR user_b_id = ${userId})
      ORDER BY match_id
      FOR UPDATE
    `);
    const activeIds = active.map(r => r.match_id);

    await abandonMatchesTx(tx, activeIds);

    await tx.delete(pendingReminders).where(eq(pendingReminders.userId, userId));
    await tx.delete(favorites).where(eq(favorites.userId, userId));
    // Unredeemed invites die with the account; redeemed ones are history.
    await tx.delete(invites).where(and(eq(invites.inviterUserId, userId), isNull(invites.redeemedByUserId)));
    await tx.delete(debugTokens).where(eq(debugTokens.userId, userId));
    await tx.delete(blocks).where(or(eq(blocks.blockerUserId, userId), eq(blocks.blockedUserId, userId)));

    await tx.update(users).set({
      appleSub: null,
      email: null,
      fullName: null,
      apnsToken: null,
      displayName: DELETED_DISPLAY_NAME,
      deletedAt: new Date(),
    }).where(eq(users.userId, userId));

    await logEvent(tx, userId, eventKind, { ...eventPayload, abandoned_matches: activeIds.length });
  });
}

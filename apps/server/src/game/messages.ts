import { eq, and, lt, desc, isNull } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { messages, matches } from '../db/schema.js';
import { dispatch } from '../notif/dispatchers.js';

export interface MessageView {
  message_id: string;
  match_id: string;
  hand_id: string | null;
  from_user_id: string;
  body: string;
  created_at: string;
}

const MAX_BODY_LENGTH = 500;

/**
 * Persist a chat message from `fromUserId` to the opponent in `matchId`.
 *
 * Optionally scope to a specific hand via `handId` — when set, the
 * message appears in both the per-hand sidebar AND the per-match
 * thread (since the per-match list includes all messages for the
 * match regardless of hand scoping).
 *
 * Fires a `chat_message` push to the opponent after the insert commits.
 */
export async function sendMessage(
  db: Database,
  matchId: string,
  fromUserId: string,
  body: string,
  handId?: string,
): Promise<MessageView> {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error('Message body cannot be empty');
  if (trimmed.length > MAX_BODY_LENGTH) throw new Error(`Message body exceeds ${MAX_BODY_LENGTH} characters`);

  const result = await db.transaction(async (tx) => {
    const m = await tx.query.matches.findFirst({ where: eq(matches.matchId, matchId) });
    if (!m) throw new Error('Match not found');
    if (m.userAId !== fromUserId && m.userBId !== fromUserId) {
      throw new Error('Not a participant');
    }

    const [row] = await tx.insert(messages).values({
      matchId,
      handId: handId ?? null,
      fromUserId,
      body: trimmed,
    }).returning();

    const toUserId = m.userAId === fromUserId ? m.userBId : m.userAId;

    return { row, toUserId };
  });

  // Post-commit push.
  await dispatch(db, {
    kind: 'chat_message',
    toUserId: result.toUserId,
    fromUserId,
    matchId,
    messageBody: result.row.body,
    dedupeKey: `chat:${result.row.messageId}`,
  });

  return toMessageView(result.row);
}

export interface ListMessagesOpts {
  /** Optional: scope to a specific hand's sidebar. */
  handId?: string;
  /** Pagination cursor — created_at of the oldest message previously returned. */
  cursor?: string;
  /** Max rows to return (default 50, max 200). */
  limit?: number;
}

export async function listMessages(
  db: Database,
  matchId: string,
  userId: string,
  opts: ListMessagesOpts = {},
): Promise<MessageView[]> {
  const m = await db.query.matches.findFirst({ where: eq(matches.matchId, matchId) });
  if (!m) throw new Error('Match not found');
  if (m.userAId !== userId && m.userBId !== userId) {
    throw new Error('Not a participant');
  }

  const limit = Math.min(opts.limit ?? 50, 200);

  const conditions = [eq(messages.matchId, matchId)];
  if (opts.handId === undefined) {
    // Match-thread query: return all messages (both hand-scoped and
    // unscoped) so the thread shows everything in chronological order.
  } else if (opts.handId === null) {
    // Explicit null — only unscoped messages (rare; most callers
    // either omit handId or pass a real id).
    conditions.push(isNull(messages.handId));
  } else {
    conditions.push(eq(messages.handId, opts.handId));
  }

  if (opts.cursor) {
    conditions.push(lt(messages.createdAt, new Date(opts.cursor)));
  }

  const rows = await db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  // Reverse so callers receive oldest-first; cursor is the OLDEST in
  // the returned page, used to fetch the next page going further back.
  return rows.reverse().map(toMessageView);
}

function toMessageView(row: typeof messages.$inferSelect): MessageView {
  return {
    message_id: row.messageId,
    match_id: row.matchId,
    hand_id: row.handId,
    from_user_id: row.fromUserId,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

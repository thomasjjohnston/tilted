import { and, eq, isNull, lte } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { pendingReminders, hands, rounds, matches } from '../db/schema.js';
import { dispatch, type NotifInput } from './dispatchers.js';

const REMINDER_DELAY_MS = 6 * 60 * 60 * 1000;

/**
 * Enqueue a reminder to re-fire 6h after the initial push.
 * Caller should invoke this *after* the triggering transaction commits,
 * alongside the initial dispatch call.
 */
export async function enqueueReminder(
  db: Database,
  kind: 'turn_handoff' | 'match_started' | 'round_complete',
  userId: string,
  matchId: string,
  roundId: string | null,
  context: Record<string, unknown>,
): Promise<void> {
  const dueAt = new Date(Date.now() + REMINDER_DELAY_MS);
  try {
    await db.insert(pendingReminders).values({
      kind,
      userId,
      matchId,
      roundId,
      dueAt,
      context,
    });
  } catch (err) {
    console.error('[reminder] enqueue failed:', err);
  }
}

/**
 * Scan pending_reminders for rows due before `now`, re-verify the
 * condition is still relevant (turn still pending, round still
 * revealing, etc.), and fire the push. Mark fired either way so the
 * row doesn't re-fire on the next tick.
 */
export async function runReminders(db: Database): Promise<number> {
  const now = new Date();
  const due = await db.query.pendingReminders.findMany({
    where: and(isNull(pendingReminders.firedAt), lte(pendingReminders.dueAt, now)),
  });

  let firedCount = 0;

  for (const r of due) {
    let relevant = false;
    try {
      relevant = await isStillRelevant(db, r);
    } catch (err) {
      console.error(`[reminder] relevance check failed for ${r.reminderId}:`, err);
    }

    if (relevant) {
      const ctx = r.context as Record<string, unknown>;
      const fromUserId = (ctx.fromUserId as string | undefined) ?? r.userId;
      const input: NotifInput = {
        kind: r.kind,
        toUserId: r.userId,
        fromUserId,
        matchId: r.matchId,
        roundId: r.roundId ?? undefined,
        roundIndex: ctx.roundIndex as number | undefined,
        handsPending: ctx.handsPending as number | undefined,
        allInCount: ctx.allInCount as number | undefined,
        winnerUserId: ctx.winnerUserId as string | undefined,
        dedupeKey: `reminder:${r.reminderId}`,
      };
      await dispatch(db, input);
      firedCount++;
    }

    await db.update(pendingReminders)
      .set({ firedAt: now })
      .where(eq(pendingReminders.reminderId, r.reminderId));
  }

  return firedCount;
}

async function isStillRelevant(db: Database, r: typeof pendingReminders.$inferSelect): Promise<boolean> {
  if (r.kind === 'turn_handoff') {
    if (!r.roundId) return false;
    const roundHands = await db.query.hands.findMany({
      where: eq(hands.roundId, r.roundId),
    });
    return roundHands.some(h => h.status === 'in_progress' && h.actionOnUserId === r.userId);
  }
  if (r.kind === 'match_started') {
    const match = await db.query.matches.findFirst({ where: eq(matches.matchId, r.matchId) });
    if (!match || match.status !== 'active') return false;
    // Opponent still hasn't acted? Proxy: any hand in round 1 with action_on = user.
    const activeRound = await db.query.rounds.findFirst({ where: eq(rounds.matchId, r.matchId) });
    if (!activeRound) return false;
    const roundHands = await db.query.hands.findMany({ where: eq(hands.roundId, activeRound.roundId) });
    return roundHands.some(h => h.actionOnUserId === r.userId && h.status === 'in_progress');
  }
  if (r.kind === 'round_complete') {
    if (!r.roundId) return false;
    const round = await db.query.rounds.findFirst({ where: eq(rounds.roundId, r.roundId) });
    return round?.status === 'revealing';
  }
  return false;
}

/**
 * Start a 5-minute interval that scans for due reminders. Call once at
 * server startup in production. Returns a function to stop the loop
 * (mostly for tests).
 */
export function startReminderLoop(db: Database, intervalMs = 5 * 60 * 1000): () => void {
  const tick = () => {
    runReminders(db).catch(err => console.error('[reminder] tick failed:', err));
  };
  // Kick off immediately so a restart catches anything that accumulated while we were down.
  tick();
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}

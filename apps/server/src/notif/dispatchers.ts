import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';
import type { Database, Transaction } from '../db/connection.js';
import { sendApnsPush } from './apns.js';

export type NotifKind =
  | 'match_started'
  | 'turn_handoff'
  | 'round_complete'
  | 'match_ended';

export interface NotifInput {
  kind: NotifKind;
  toUserId: string;
  fromUserId: string;
  matchId: string;
  roundId?: string;
  roundIndex?: number;
  handsPending?: number;
  allInCount?: number;
  winnerUserId?: string;
  /** deterministic id — used as apns-id for idempotent retries. */
  dedupeKey: string;
}

/**
 * Compose + send a user-facing push for one of four notification kinds.
 *
 * Callers MUST run this *after* committing their transaction — not
 * inside it. A rollback-after-dispatch would land a push for an event
 * that never happened.
 */
export async function dispatch(db: Database | Transaction, n: NotifInput): Promise<void> {
  const toUser = await db.query.users.findFirst({ where: eq(users.userId, n.toUserId) });
  const fromUser = await db.query.users.findFirst({ where: eq(users.userId, n.fromUserId) });
  if (!toUser?.apnsToken || !fromUser) {
    console.log(`[notif] skip ${n.kind}: toUser=${n.toUserId} apnsToken=${toUser?.apnsToken ? 'yes' : 'no'} fromUser=${fromUser ? 'yes' : 'no'}`);
    return;
  }

  const opponentFirst = fromUser.displayName.split(' ')[0] ?? fromUser.displayName;

  let body = '';
  let category = 'GENERIC';
  const payload: Record<string, unknown> = {
    match_id: n.matchId,
    kind: n.kind,
  };
  if (n.roundId) payload.round_id = n.roundId;

  switch (n.kind) {
    case 'match_started':
      body = `New match! ${opponentFirst} dealt round 1 — 10 hands waiting.`;
      category = 'MATCH_STARTED';
      break;
    case 'turn_handoff': {
      const n1 = n.handsPending ?? 1;
      body = `${opponentFirst} finished their turn. ${n1} hand${n1 === 1 ? '' : 's'} await you.`;
      category = 'TURN_HANDOFF';
      break;
    }
    case 'round_complete': {
      const n1 = n.allInCount ?? 0;
      const idx = n.roundIndex ?? 0;
      if (n1 > 0) {
        body = `Round ${idx} complete! ${n1} all-in hand${n1 === 1 ? '' : 's'} ready to reveal.`;
      } else {
        body = `Round ${idx} complete — tap to see the results.`;
      }
      category = 'ROUND_COMPLETE';
      break;
    }
    case 'match_ended':
      body = n.winnerUserId === n.toUserId
        ? 'Match over — you won!'
        : `Match over — ${opponentFirst} won.`;
      category = 'MATCH_ENDED';
      break;
  }

  try {
    await sendApnsPush(toUser.apnsToken, n.dedupeKey, {
      aps: {
        alert: { title: 'Tilted', body },
        sound: 'default',
        category,
      },
      ...payload,
    });
  } catch (err) {
    // Don't fail upstream callers on push errors.
    console.error(`[notif] dispatch ${n.kind} failed:`, err);
  }
}

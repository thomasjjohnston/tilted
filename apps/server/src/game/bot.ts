// Untilted: the solver-backed bot player (shell side).
//
// The bot is an ordinary user row (is_bot = true). When control passes to it
// — post-commit, mirroring the APNS pattern — this module builds the bot's
// USER-SCOPED view (getMatchState as the bot: it sees exactly what a human
// in its seat would see, hole-card redaction included), decides every
// pending hand via the trained strategies, and submits one normal turn
// batch through applyTurnBatch. No special-cased game rules anywhere.

import { asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { actions, users } from '../db/schema.js';
import type { Card } from '../engine/types.js';
import { decideBotHand, type BotHandInput, type RecordedAction } from '../engine/solver/bot.js';
import { getMatchState } from './match.js';
import { getSolverMeta, lookupStrategy } from './solver-strategies.js';

/** Users allowed to see/challenge the bot. Comma-separated user ids, or '*'. */
export function botTesterAllowlist(): string[] | '*' {
  const raw = (process.env.TILTED_BOT_TESTERS ?? '').trim();
  if (raw === '*') return '*';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export function userMayAccessBot(userId: string): boolean {
  const allow = botTesterAllowlist();
  return allow === '*' || allow.includes(userId);
}

export async function findBotUserId(db: Database): Promise<string | null> {
  const bot = await db.query.users.findFirst({ where: eq(users.isBot, true) });
  return bot?.userId ?? null;
}

/**
 * If any of the given handoffs passed control to the bot, take the bot's
 * whole turn. Returns true if the bot acted (callers should re-fetch state).
 * Never throws into the caller's request path — a bot failure must not break
 * the human's submit; it logs and leaves the turn pending instead.
 */
export async function maybeRunBotTurn(
  db: Database,
  handoffs: { toUserId: string; matchId: string }[],
): Promise<boolean> {
  if (handoffs.length === 0) return false;
  const botId = await findBotUserId(db);
  if (!botId) return false;
  const handoff = handoffs.find(h => h.toUserId === botId);
  if (!handoff) return false;
  try {
    return await runBotTurnIfPending(db, handoff.matchId, botId);
  } catch (err) {
    console.error(`[untilted] bot turn failed for match ${handoff.matchId}:`, err);
    return false;
  }
}

/** Take the bot's turn in a match if it has pending hands. */
export async function runBotTurnIfPending(
  db: Database,
  matchId: string,
  botId?: string,
): Promise<boolean> {
  const botUserId = botId ?? (await findBotUserId(db));
  if (!botUserId) return false;

  const meta = await getSolverMeta(db);
  if (!meta) {
    console.error('[untilted] no solver strategies imported — bot cannot act');
    return false;
  }

  // A single turn can hand control right back (bot checks as BB, street
  // closes, bot is first to act postflop) — keep taking turns until the bot
  // has nothing pending. Bounded: a hand has < 32 decision points and a
  // round has 10 hands.
  let acted = false;
  for (let cycle = 0; cycle < 40; cycle++) {
    const tookTurn = await runOneBotCycle(db, matchId, botUserId, meta);
    if (!tookTurn) break;
    acted = true;
  }
  return acted;
}

async function runOneBotCycle(
  db: Database,
  matchId: string,
  botUserId: string,
  meta: NonNullable<Awaited<ReturnType<typeof getSolverMeta>>>,
): Promise<boolean> {
  const state = await getMatchState(db, matchId, botUserId);
  const round = state.current_round;
  if (!round || state.status !== 'active') return false;
  const pending = round.hands.filter(h => h.action_on_me && h.status === 'in_progress');
  if (pending.length === 0) return false;

  const botIsSb = round.my_role === 'sb';
  const sbUserId = botIsSb ? botUserId : state.opponent.user_id;

  const rows = await db.query.actions.findMany({
    where: inArray(actions.handId, pending.map(h => h.hand_id)),
    orderBy: [asc(actions.serverRecordedAt)],
  });
  const rowsByHand = new Map<string, RecordedAction[]>();
  for (const r of rows) {
    const list = rowsByHand.get(r.handId) ?? [];
    list.push({
      actingUserId: r.actingUserId,
      actionType: r.actionType as RecordedAction['actionType'],
      amount: r.amount,
      street: r.street,
    });
    rowsByHand.set(r.handId, list);
  }

  const batch: { handId: string; actionType: RecordedAction['actionType']; amount: number; clientTxId: string }[] = [];
  for (const hand of pending) {
    const input: BotHandInput = {
      handId: hand.hand_id,
      botIsSb,
      holeCards: hand.my_hole as [Card, Card],
      board: (hand.board ?? []) as Card[],
      actionRows: rowsByHand.get(hand.hand_id) ?? [],
      sbUserId,
      myReserved: hand.my_reserved,
      oppReserved: hand.opponent_reserved,
      myAvailable: state.my_available,
      oppAvailable: state.opponent_available,
    };
    const decision = await decideBotHand(
      input,
      meta.config,
      meta.buckets,
      meta.depths,
      (depthBb, street, seq, bucket) => lookupStrategy(db, depthBb, street, seq, bucket),
    );
    if (decision.meta.offBook) {
      console.warn(
        `[untilted] off-book at hand ${hand.hand_id} seq "${decision.meta.seq}" — passive fallback`,
      );
    }
    batch.push({
      handId: hand.hand_id,
      actionType: decision.actionType,
      amount: decision.amount,
      // Deterministic per decision point: a retried bot turn dedupes cleanly.
      clientTxId: `untilted-${hand.hand_id.slice(0, 8)}-${decision.meta.seq || 'root'}`,
    });
  }

  // Dynamic import to break the turn.ts <-> bot.ts cycle (same pattern as
  // the admin CLI's deferred imports).
  const { applyTurnBatch } = await import('./turn.js');
  await applyTurnBatch(db, botUserId, { actions: batch }, { isBotTurn: true });
  return true;
}

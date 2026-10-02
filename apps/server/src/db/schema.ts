import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  unique,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Users (2 rows ever for MVP) ──────────────────────────────────────────────

export const users = pgTable('users', {
  userId: uuid('user_id').primaryKey().defaultRandom(),
  appleSub: text('apple_sub').unique(),
  email: text('email'),
  fullName: text('full_name'),
  displayName: text('display_name').notNull(),
  isBot: boolean('is_bot').notNull().default(false),
  apnsToken: text('apns_token'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Debug tokens (MVP auth) ──────────────────────────────────────────────────

export const debugTokens = pgTable('debug_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.userId),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Matches ──────────────────────────────────────────────────────────────────

export const matches = pgTable('matches', {
  matchId: uuid('match_id').primaryKey().defaultRandom(),
  userAId: uuid('user_a_id').notNull().references(() => users.userId),
  userBId: uuid('user_b_id').notNull().references(() => users.userId),
  startingStack: integer('starting_stack').notNull().default(2000),
  blindSmall: integer('blind_small').notNull().default(5),
  blindBig: integer('blind_big').notNull().default(10),
  status: text('status').notNull().$type<'active' | 'ended'>(),
  winnerUserId: uuid('winner_user_id').references(() => users.userId),
  sbOfRound1: uuid('sb_of_round_1').notNull().references(() => users.userId),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  userATotal: integer('user_a_total').notNull(),
  userBTotal: integer('user_b_total').notNull(),
}, (table) => [
  check('matches_status_check', sql`${table.status} in ('active', 'ended')`),
]);

// ── Rounds ───────────────────────────────────────────────────────────────────

export const rounds = pgTable('rounds', {
  roundId: uuid('round_id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').notNull().references(() => matches.matchId),
  roundIndex: integer('round_index').notNull(),
  sbUserId: uuid('sb_user_id').notNull().references(() => users.userId),
  bbUserId: uuid('bb_user_id').notNull().references(() => users.userId),
  status: text('status').notNull().$type<'dealing' | 'in_progress' | 'revealing' | 'complete'>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  unique('rounds_match_round_idx').on(table.matchId, table.roundIndex),
  check('rounds_status_check', sql`${table.status} in ('dealing', 'in_progress', 'revealing', 'complete')`),
]);

// ── Hands ────────────────────────────────────────────────────────────────────

export const hands = pgTable('hands', {
  handId: uuid('hand_id').primaryKey().defaultRandom(),
  roundId: uuid('round_id').notNull().references(() => rounds.roundId),
  handIndex: integer('hand_index').notNull(),
  deckSeed: text('deck_seed').notNull(),
  userAHole: jsonb('user_a_hole').notNull().$type<string[]>(),
  userBHole: jsonb('user_b_hole').notNull().$type<string[]>(),
  board: jsonb('board').notNull().$type<string[]>().default([]),
  pot: integer('pot').notNull().default(0),
  userAReserved: integer('user_a_reserved').notNull().default(0),
  userBReserved: integer('user_b_reserved').notNull().default(0),
  street: text('street').notNull().$type<'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete'>(),
  actionOnUserId: uuid('action_on_user_id').references(() => users.userId),
  status: text('status').notNull().$type<'in_progress' | 'awaiting_runout' | 'complete'>(),
  terminalReason: text('terminal_reason').$type<'fold' | 'showdown' | null>(),
  // Street the hand resolved on. Populated alongside terminalReason at
  // settlement: 'preflop' | 'flop' | 'turn' | 'river' for folds, and the
  // last betting street for showdowns. Null while in_progress.
  foldStreet: text('fold_street').$type<'preflop' | 'flop' | 'turn' | 'river' | null>(),
  winnerUserId: uuid('winner_user_id').references(() => users.userId),
  // Net chip change for each user at the moment the hand resolved.
  // Snapshotted because settleHand zeros userAReserved/userBReserved when
  // chips move into matches.userATotal/userBTotal — without these, the
  // turn report has no way to show per-hand +/- (the "0 win/loss" bug).
  resolvedNetForA: integer('resolved_net_for_a'),
  resolvedNetForB: integer('resolved_net_for_b'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  unique('hands_round_hand_idx').on(table.roundId, table.handIndex),
  check('hands_index_check', sql`${table.handIndex} between 0 and 9`),
  check('hands_street_check', sql`${table.street} in ('preflop', 'flop', 'turn', 'river', 'showdown', 'complete')`),
  check('hands_status_check', sql`${table.status} in ('in_progress', 'awaiting_runout', 'complete')`),
]);

// ── Actions ──────────────────────────────────────────────────────────────────

export const actions = pgTable('actions', {
  actionId: uuid('action_id').primaryKey().defaultRandom(),
  handId: uuid('hand_id').notNull().references(() => hands.handId),
  street: text('street').notNull(),
  actingUserId: uuid('acting_user_id').notNull().references(() => users.userId),
  actionType: text('action_type').notNull().$type<'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in'>(),
  amount: integer('amount').notNull().default(0),
  potAfter: integer('pot_after').notNull(),
  clientTxId: text('client_tx_id').notNull(),
  clientSentAt: timestamp('client_sent_at', { withTimezone: true }),
  serverRecordedAt: timestamp('server_recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('actions_idempotency_idx').on(table.handId, table.clientTxId),
  check('actions_type_check', sql`${table.actionType} in ('fold', 'check', 'call', 'bet', 'raise', 'all_in')`),
]);

// ── Favorites ────────────────────────────────────────────────────────────────

export const favorites = pgTable('favorites', {
  userId: uuid('user_id').notNull().references(() => users.userId),
  handId: uuid('hand_id').notNull().references(() => hands.handId),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.handId] }),
]);

// ── Turn handoffs (notification idempotency) ─────────────────────────────────

export const turnHandoffs = pgTable('turn_handoffs', {
  handoffId: uuid('handoff_id').primaryKey().defaultRandom(),
  roundId: uuid('round_id').notNull().references(() => rounds.roundId),
  fromUserId: uuid('from_user_id').notNull().references(() => users.userId),
  toUserId: uuid('to_user_id').notNull().references(() => users.userId),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Pending reminders (6h stale-turn re-push) ────────────────────────────────

export const pendingReminders = pgTable('pending_reminders', {
  reminderId: uuid('reminder_id').primaryKey().defaultRandom(),
  kind: text('kind').notNull().$type<'turn_handoff' | 'match_started' | 'round_complete'>(),
  userId: uuid('user_id').notNull().references(() => users.userId),
  matchId: uuid('match_id').notNull().references(() => matches.matchId),
  roundId: uuid('round_id').references(() => rounds.roundId),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }),
  context: jsonb('context').notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── App events (minimal observability) ───────────────────────────────────────

export const appEvents = pgTable('app_events', {
  eventId: uuid('event_id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.userId),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Solver strategies (Untilted bot; imported from the offline artifact) ─────
// Frequencies only — the bot samples mixed strategies; EVs stay offline.
// Populated by `tools/solver: uv run solver.py import-pg`, never by the app.

export const solverMeta = pgTable('solver_meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

export const solverStrategies = pgTable('solver_strategies', {
  depthBb: integer('depth_bb').notNull(),
  street: integer('street').notNull(),
  seq: text('seq').notNull(),
  bucket: integer('bucket').notNull(),
  /** Legal action tokens at this infoset, e.g. ["f","c","r1","a"] */
  tokens: jsonb('tokens').notNull().$type<string[]>(),
  /** Average-strategy probabilities aligned with tokens; sums to ~1. */
  strategy: jsonb('strategy').notNull().$type<number[]>(),
}, (table) => [
  primaryKey({ columns: [table.depthBb, table.street, table.seq, table.bucket] }),
]);

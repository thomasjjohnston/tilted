// Integration test helpers.
//
// Shared Postgres DB across the suite (started in globalSetup). Each
// freshDb() call returns a drizzle handle and a cleanup() that TRUNCATEs
// every row from every domain table — sequential tests stay isolated
// without paying for fresh containers or migration replays per test.

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema.js';
import type { Database } from '../../src/db/connection.js';

export interface TestEnv {
  db: Database;
  cleanup: () => Promise<void>;
}

const TABLES = [
  // Order matters — children first, then parents.
  'app_events',
  'pending_reminders',
  'turn_handoffs',
  'favorites',
  'actions',
  'hands',
  'rounds',
  'matches',
  'debug_tokens',
  'users',
];

let cachedClient: ReturnType<typeof postgres> | undefined;
let cachedDb: Database | undefined;

function getDb(): { db: Database; client: ReturnType<typeof postgres> } {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST not set — integration test setup failed');
  if (!cachedClient || !cachedDb) {
    cachedClient = postgres(url, { max: 4 });
    cachedDb = drizzle(cachedClient, { schema }) as unknown as Database;
  }
  return { db: cachedDb, client: cachedClient };
}

export async function freshDb(): Promise<TestEnv> {
  const { db, client } = getDb();
  // Wipe state from the previous test.
  await client.unsafe(`TRUNCATE TABLE ${TABLES.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  return {
    db,
    cleanup: async () => {
      // No-op — connection is shared. Truncation happens at the start of
      // each test, not the end.
    },
  };
}

// ── Fixture builders ─────────────────────────────────────────────────

let userCounter = 0;

export async function seedUser(
  db: Database,
  opts: { displayName?: string } = {},
): Promise<{ userId: string; displayName: string }> {
  userCounter++;
  const displayName = opts.displayName ?? `TestUser ${userCounter}`;
  const [row] = await db.insert(schema.users).values({ displayName }).returning();
  return { userId: row.userId, displayName: row.displayName };
}

export async function seedMatch(
  db: Database,
  userAId: string,
  userBId: string,
  opts: { sbOfRound1?: string; startingStack?: number; blindSmall?: number; blindBig?: number } = {},
): Promise<{ matchId: string; sbOfRound1: string }> {
  const startingStack = opts.startingStack ?? 2000;
  const sbOfRound1 = opts.sbOfRound1 ?? userAId;
  const [row] = await db.insert(schema.matches).values({
    userAId,
    userBId,
    startingStack,
    blindSmall: opts.blindSmall ?? 5,
    blindBig: opts.blindBig ?? 10,
    status: 'active',
    sbOfRound1,
    userATotal: startingStack,
    userBTotal: startingStack,
  }).returning();
  return { matchId: row.matchId, sbOfRound1: row.sbOfRound1 };
}

export async function seedRound(
  db: Database,
  matchId: string,
  opts: { roundIndex?: number; sbUserId: string; bbUserId: string },
): Promise<{ roundId: string }> {
  const [row] = await db.insert(schema.rounds).values({
    matchId,
    roundIndex: opts.roundIndex ?? 1,
    sbUserId: opts.sbUserId,
    bbUserId: opts.bbUserId,
    status: 'in_progress',
  }).returning();
  return { roundId: row.roundId };
}

export interface SeedHandOpts {
  handIndex?: number;
  userAHole?: string[];
  userBHole?: string[];
  board?: string[];
  pot?: number;
  userAReserved?: number;
  userBReserved?: number;
  street?: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
  status?: 'in_progress' | 'awaiting_runout' | 'complete';
  actionOnUserId?: string | null;
  deckSeed?: string;
  winnerUserId?: string | null;
  terminalReason?: 'fold' | 'showdown' | null;
}

export async function seedHand(
  db: Database,
  roundId: string,
  opts: SeedHandOpts = {},
): Promise<{ handId: string }> {
  const [row] = await db.insert(schema.hands).values({
    roundId,
    handIndex: opts.handIndex ?? 0,
    deckSeed: opts.deckSeed ?? `seed-${Math.random().toString(36).slice(2, 18)}`,
    userAHole: opts.userAHole ?? ['Ah', 'Ks'],
    userBHole: opts.userBHole ?? ['Qd', 'Jc'],
    board: opts.board ?? [],
    pot: opts.pot ?? 15,
    userAReserved: opts.userAReserved ?? 5,
    userBReserved: opts.userBReserved ?? 10,
    street: opts.street ?? 'preflop',
    status: opts.status ?? 'in_progress',
    actionOnUserId: opts.actionOnUserId === undefined ? null : opts.actionOnUserId,
    winnerUserId: opts.winnerUserId,
    terminalReason: opts.terminalReason ?? null,
  }).returning();
  return { handId: row.handId };
}

/**
 * Common scenario: alice (SB, user A) vs bob (BB, user B), one round,
 * one preflop hand with action on alice. Blinds already posted.
 */
export async function seedBaseScenario(db: Database): Promise<{
  alice: { userId: string };
  bob: { userId: string };
  matchId: string;
  roundId: string;
  handId: string;
}> {
  const alice = await seedUser(db, { displayName: 'Alice' });
  const bob = await seedUser(db, { displayName: 'Bob' });
  const match = await seedMatch(db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
  const round = await seedRound(db, match.matchId, { sbUserId: alice.userId, bbUserId: bob.userId });
  const hand = await seedHand(db, round.roundId, { actionOnUserId: alice.userId });
  return {
    alice: { userId: alice.userId },
    bob: { userId: bob.userId },
    matchId: match.matchId,
    roundId: round.roundId,
    handId: hand.handId,
  };
}

export const skipIfNoDb = !process.env.DATABASE_URL_TEST;

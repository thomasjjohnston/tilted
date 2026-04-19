import { eq, and, sql, ne, inArray } from 'drizzle-orm';
import type { Database, Transaction } from '../db/connection.js';
import { matches, rounds, hands, users, actions, favorites } from '../db/schema.js';
import { USER_TJ_ID, USER_SL_ID } from '../db/seed.js';
import { STARTING_STACK, BLIND_SMALL, BLIND_BIG, HANDS_PER_ROUND, MIN_CHIPS_FOR_ROUND } from './constants.js';
import { openRound } from './round.js';
import { generateActionSketch } from './action-sketch.js';
import { dispatch } from '../notif/dispatchers.js';

/**
 * Create a new match between the two hardcoded users.
 * Coin flip determines who is SB in round 1.
 */
export async function createMatch(db: Database, requestingUserId: string) {
  const result = await db.transaction(async (tx) => {
    // Check no active match exists
    const activeMatch = await tx.query.matches.findFirst({
      where: eq(matches.status, 'active'),
    });
    if (activeMatch) {
      throw new Error('An active match already exists');
    }

    // Coin flip for SB of round 1
    const sbOfRound1 = Math.random() < 0.5 ? USER_TJ_ID : USER_SL_ID;

    const [match] = await tx.insert(matches).values({
      userAId: USER_TJ_ID,
      userBId: USER_SL_ID,
      startingStack: STARTING_STACK,
      blindSmall: BLIND_SMALL,
      blindBig: BLIND_BIG,
      status: 'active',
      sbOfRound1,
      userATotal: STARTING_STACK,
      userBTotal: STARTING_STACK,
    }).returning();

    // Open round 1
    const roundId = await openRound(tx, match.matchId, 1);

    return { match, roundId };
  });

  // Post-commit: tell the opponent a new match is live.
  const opponentId = requestingUserId === USER_TJ_ID ? USER_SL_ID : USER_TJ_ID;
  await dispatch(db, {
    kind: 'match_started',
    toUserId: opponentId,
    fromUserId: requestingUserId,
    matchId: result.match.matchId,
    roundId: result.roundId,
    dedupeKey: `match-started:${result.match.matchId}`,
  });

  return result.match;
}

/**
 * Get the current active match, or null if none.
 * Returns a user-scoped view.
 */
export async function getCurrentMatch(
  db: Database,
  userId: string,
): Promise<MatchStateView | null> {
  const match = await db.query.matches.findFirst({
    where: eq(matches.status, 'active'),
  });

  if (!match) return null;

  return getMatchState(db, match.matchId, userId);
}

/**
 * Build the user-scoped match state view.
 */
export async function getMatchState(
  db: Database | Transaction,
  matchId: string,
  userId: string,
): Promise<MatchStateView> {
  const match = await db.query.matches.findFirst({
    where: eq(matches.matchId, matchId),
  });
  if (!match) throw new Error(`Match ${matchId} not found`);

  const isUserA = match.userAId === userId;
  const opponentId = isUserA ? match.userBId : match.userAId;

  const opponent = await db.query.users.findFirst({
    where: eq(users.userId, opponentId),
  });

  // Get current round (most recent)
  const currentRound = await db.query.rounds.findFirst({
    where: and(
      eq(rounds.matchId, matchId),
      ne(rounds.status, 'complete'),
    ),
  });

  // Calculate reserved chips per user
  let myReserved = 0;
  let opponentReserved = 0;
  let roundView: RoundView | null = null;

  if (currentRound) {
    const roundHands = await db.query.hands.findMany({
      where: eq(hands.roundId, currentRound.roundId),
    });

    for (const h of roundHands) {
      myReserved += isUserA ? h.userAReserved : h.userBReserved;
      opponentReserved += isUserA ? h.userBReserved : h.userAReserved;
    }

    const myPending = roundHands.filter(h =>
      h.status === 'in_progress' && h.actionOnUserId === userId
    ).length;
    const opponentPending = roundHands.filter(h =>
      h.status === 'in_progress' && h.actionOnUserId === opponentId
    ).length;

    // Fetch all actions for this round's hands in one query
    const handIds = roundHands.map(h => h.handId);
    const allActions = handIds.length > 0
      ? await db.query.actions.findMany({
          where: inArray(actions.handId, handIds),
        })
      : [];

    // Group actions by hand
    const actionsByHand = new Map<string, typeof allActions>();
    for (const a of allActions) {
      const list = actionsByHand.get(a.handId) ?? [];
      list.push(a);
      actionsByHand.set(a.handId, list);
    }

    const handViews: HandView[] = roundHands.map(h => {
      const handActions = actionsByHand.get(h.handId) ?? [];
      return buildHandView(h, userId, isUserA, match, currentRound, handActions);
    });

    roundView = {
      round_id: currentRound.roundId,
      round_index: currentRound.roundIndex,
      status: currentRound.status,
      my_role: currentRound.sbUserId === userId ? 'sb' : 'bb',
      hands_pending_me: myPending,
      hands_pending_opponent: opponentPending,
      hands: handViews,
    };
  }

  // Also get completed rounds count for stats
  const completedRound = await db.query.rounds.findFirst({
    where: and(
      eq(rounds.matchId, matchId),
      eq(rounds.status, 'complete'),
    ),
  });

  const myTotal = isUserA ? match.userATotal : match.userBTotal;
  const oppTotal = isUserA ? match.userBTotal : match.userATotal;

  return {
    match_id: match.matchId,
    status: match.status,
    winner_user_id: match.winnerUserId,
    opponent: {
      user_id: opponentId,
      display_name: opponent?.displayName ?? 'Unknown',
    },
    my_total: myTotal,
    opponent_total: oppTotal,
    my_reserved: myReserved,
    opponent_reserved: opponentReserved,
    my_available: myTotal - myReserved,
    opponent_available: oppTotal - opponentReserved,
    current_round: roundView,
  };
}

function buildHandView(
  h: typeof hands.$inferSelect,
  userId: string,
  isUserA: boolean,
  match: typeof matches.$inferSelect,
  round: typeof rounds.$inferSelect,
  handActions: (typeof actions.$inferSelect)[],
): HandView {
  const myHole = isUserA ? h.userAHole : h.userBHole;
  let opponentHole: string[] | null = null;

  if (h.status === 'complete' && h.terminalReason === 'showdown') {
    opponentHole = isUserA ? h.userBHole : h.userAHole;
  }

  const myReserved = isUserA ? h.userAReserved : h.userBReserved;
  const opponentReserved = isUserA ? h.userBReserved : h.userAReserved;

  // Generate action summary
  const sortedActions = [...handActions].sort(
    (a, b) => a.serverRecordedAt.getTime() - b.serverRecordedAt.getTime()
  );
  const summary = generateActionSketch(
    sortedActions.map(a => ({
      street: a.street,
      actingUserId: a.actingUserId,
      actionType: a.actionType,
      amount: a.amount,
    })),
    h.winnerUserId,
    h.pot,
    round.sbUserId,
    round.bbUserId,
  );

  return {
    hand_id: h.handId,
    hand_index: h.handIndex,
    my_hole: myHole as string[],
    opponent_hole: opponentHole,
    board: h.board as string[],
    pot: h.pot,
    my_reserved: myReserved,
    opponent_reserved: opponentReserved,
    street: h.street,
    status: h.status,
    action_on_me: h.actionOnUserId === userId,
    terminal_reason: h.terminalReason,
    winner_user_id: h.winnerUserId,
    action_summary: summary,
  };
}

/**
 * End a match with a winner.
 */
export async function endMatch(
  tx: Transaction,
  matchId: string,
  winnerUserId: string,
): Promise<void> {
  await tx.update(matches)
    .set({
      status: 'ended',
      winnerUserId,
      endedAt: new Date(),
    })
    .where(eq(matches.matchId, matchId));
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface MatchStateView {
  match_id: string;
  status: string;
  winner_user_id: string | null;
  opponent: { user_id: string; display_name: string };
  my_total: number;
  opponent_total: number;
  my_reserved: number;
  opponent_reserved: number;
  my_available: number;
  opponent_available: number;
  current_round: RoundView | null;
}

export interface RoundView {
  round_id: string;
  round_index: number;
  status: string;
  my_role: 'sb' | 'bb';
  hands_pending_me: number;
  hands_pending_opponent: number;
  hands: HandView[];
}

export interface HandView {
  hand_id: string;
  hand_index: number;
  my_hole: string[];
  opponent_hole: string[] | null;
  board: string[];
  pot: number;
  my_reserved: number;
  opponent_reserved: number;
  street: string;
  status: string;
  action_on_me: boolean;
  terminal_reason: string | null;
  winner_user_id: string | null;
  action_summary: string;
}

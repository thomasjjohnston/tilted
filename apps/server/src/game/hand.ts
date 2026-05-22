import { eq, and } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { hands, actions, rounds, matches, favorites, appEvents } from '../db/schema.js';
import type { Card } from '../engine/types.js';
import { evaluate } from '../engine/evaluator.js';

export interface HandDetailView {
  hand_id: string;
  hand_index: number;
  round_index: number;
  match_id: string;
  my_hole: string[];
  opponent_hole: string[] | null;
  board: string[];
  pot: number;
  street: string;
  status: string;
  terminal_reason: string | null;
  winner_user_id: string | null;
  is_favorited: boolean;
  my_hand_rank: string | null;
  opponent_hand_rank: string | null;
  /** Indices (0/1) of cards the requesting user has voluntarily shown. */
  my_shown_indices: number[];
  /** Indices (0/1) of cards the opponent has voluntarily shown. */
  opponent_shown_indices: number[];
  actions: ActionView[];
}

export interface ActionView {
  action_id: string;
  street: string;
  acting_user_id: string;
  action_type: string;
  amount: number;
  pot_after: number;
  client_sent_at: string | null;
  server_recorded_at: string;
}

/**
 * Get full hand detail for replay.
 * Applies hole-card redaction rules:
 * - If hand folded, folder's cards are NOT shown
 * - If showdown, both shown
 * - If awaiting_runout, opponent's cards shown (both are all-in)
 */
export async function getHandDetail(
  db: Database,
  handId: string,
  userId: string,
): Promise<HandDetailView> {
  const hand = await db.query.hands.findFirst({
    where: eq(hands.handId, handId),
  });
  if (!hand) throw new Error(`Hand ${handId} not found`);

  const round = await db.query.rounds.findFirst({
    where: eq(rounds.roundId, hand.roundId),
  });
  if (!round) throw new Error('Round not found');

  const match = await db.query.matches.findFirst({
    where: eq(matches.matchId, round.matchId),
  });
  if (!match) throw new Error('Match not found');

  const isUserA = match.userAId === userId;

  // My hole cards (always visible to me)
  const myHole = (isUserA ? hand.userAHole : hand.userBHole) as string[];

  // Opponent's full hole — revealed at showdown / awaiting_runout.
  const opponentFullHole = (isUserA ? hand.userBHole : hand.userAHole) as string[];

  // Voluntary show indices. The requesting user sees their OWN shown
  // set (so the UI can mark which they've revealed) AND the OPPONENT's
  // shown indices (so the UI can render those specific cards face-up).
  const myShownIndices = (isUserA ? hand.shownIndicesByA : hand.shownIndicesByB) ?? [];
  const opponentShownIndices = (isUserA ? hand.shownIndicesByB : hand.shownIndicesByA) ?? [];

  // Opponent's hole cards visible to the requesting user:
  //   - showdown / awaiting_runout: full reveal
  //   - otherwise: only the cards the opponent voluntarily showed
  let opponentHole: string[] | null = null;
  if (hand.status === 'complete' && hand.terminalReason === 'showdown') {
    opponentHole = opponentFullHole;
  } else if (hand.status === 'awaiting_runout') {
    opponentHole = opponentFullHole;
  } else if (opponentShownIndices.length > 0) {
    opponentHole = opponentShownIndices
      .map((i: number) => opponentFullHole[i])
      .filter((c): c is string => typeof c === 'string');
  }

  // Get all actions for this hand
  const handActions = await db.query.actions.findMany({
    where: eq(actions.handId, handId),
  });

  // Sort by server_recorded_at
  handActions.sort((a, b) =>
    a.serverRecordedAt.getTime() - b.serverRecordedAt.getTime()
  );

  // Check if favorited
  const fav = await db.query.favorites.findFirst({
    where: and(
      eq(favorites.userId, userId),
      eq(favorites.handId, handId),
    ),
  });

  // Compute hand ranks if we have enough cards for evaluation
  const board = hand.board as Card[];
  let myHandRank: string | null = null;
  let opponentHandRank: string | null = null;

  if (myHole.length === 2 && board.length >= 3) {
    try {
      myHandRank = evaluate(myHole as Card[], board).name;
    } catch { /* not enough cards */ }
  }
  if (opponentHole && opponentHole.length === 2 && board.length >= 3) {
    try {
      opponentHandRank = evaluate(opponentHole as Card[], board).name;
    } catch { /* not enough cards */ }
  }

  return {
    hand_id: hand.handId,
    hand_index: hand.handIndex,
    round_index: round.roundIndex,
    match_id: round.matchId,
    my_hole: myHole,
    opponent_hole: opponentHole,
    board: hand.board as string[],
    pot: hand.pot,
    street: hand.street,
    status: hand.status,
    terminal_reason: hand.terminalReason,
    winner_user_id: hand.winnerUserId,
    is_favorited: !!fav,
    my_hand_rank: myHandRank,
    opponent_hand_rank: opponentHandRank,
    my_shown_indices: myShownIndices,
    opponent_shown_indices: opponentShownIndices,
    actions: handActions.map(a => ({
      action_id: a.actionId,
      street: a.street,
      acting_user_id: a.actingUserId,
      action_type: a.actionType,
      amount: a.amount,
      pot_after: a.potAfter,
      client_sent_at: a.clientSentAt?.toISOString() ?? null,
      server_recorded_at: a.serverRecordedAt.toISOString(),
    })),
  };
}

/**
 * Voluntarily show one or both of your hole cards on a completed hand.
 * Reveal is one-way — calling with [0] then [1] adds the second card;
 * the cards remain shown thereafter (no un-show).
 *
 * Requirements:
 *   - Hand must be in `complete` status (no live-show during action).
 *   - User must be a participant of the match.
 *   - `indices` must be a non-empty subset of [0, 1].
 */
export async function showCards(
  db: Database,
  handId: string,
  userId: string,
  indices: number[],
): Promise<HandDetailView> {
  if (indices.length === 0) throw new Error('Must show at least one card');
  if (indices.some(i => i !== 0 && i !== 1)) throw new Error('Invalid card index');

  await db.transaction(async (tx) => {
    const hand = await tx.query.hands.findFirst({ where: eq(hands.handId, handId) });
    if (!hand) throw new Error('Hand not found');
    if (hand.status !== 'complete') throw new Error('Hand is not complete');

    const round = await tx.query.rounds.findFirst({ where: eq(rounds.roundId, hand.roundId) });
    if (!round) throw new Error('Round not found');
    const match = await tx.query.matches.findFirst({ where: eq(matches.matchId, round.matchId) });
    if (!match) throw new Error('Match not found');
    if (match.userAId !== userId && match.userBId !== userId) {
      throw new Error('Not a participant');
    }

    const isUserA = match.userAId === userId;
    // Merge incoming indices with existing — never un-shows.
    const existing = (isUserA ? hand.shownIndicesByA : hand.shownIndicesByB) ?? [];
    const merged = Array.from(new Set([...existing, ...indices])).sort();

    if (isUserA) {
      await tx.update(hands).set({ shownIndicesByA: merged }).where(eq(hands.handId, handId));
    } else {
      await tx.update(hands).set({ shownIndicesByB: merged }).where(eq(hands.handId, handId));
    }

    await tx.insert(appEvents).values({
      userId,
      kind: 'cards_shown',
      payload: { hand_id: handId, indices: merged },
    });
  });

  return getHandDetail(db, handId, userId);
}


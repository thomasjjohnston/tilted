import { eq, and } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { hands, actions, rounds, matches, favorites } from '../db/schema.js';
import type { Card } from '../engine/types.js';

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

  // Opponent's hole cards (visibility depends on terminal state)
  let opponentHole: string[] | null = null;
  if (hand.status === 'complete' && hand.terminalReason === 'showdown') {
    opponentHole = (isUserA ? hand.userBHole : hand.userAHole) as string[];
  } else if (hand.status === 'awaiting_runout') {
    // Both players are all-in; cards will be revealed at round end
    opponentHole = (isUserA ? hand.userBHole : hand.userAHole) as string[];
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

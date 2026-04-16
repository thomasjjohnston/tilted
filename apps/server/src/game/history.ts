import { eq, and, sql, desc, lt } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { hands, rounds, matches, favorites, actions } from '../db/schema.js';

export interface HistoryOptions {
  matchId?: string;
  favoritesOnly: boolean;
  result: 'won' | 'lost' | 'all';
  roundIndex?: number;
  cursor?: string;
  limit: number;
}

export interface HistoryHandView {
  hand_id: string;
  hand_index: number;
  round_index: number;
  match_id: string;
  board: string[];
  pot: number;
  winner_user_id: string | null;
  terminal_reason: string | null;
  is_favorited: boolean;
  completed_at: string | null;
  my_hole: string[];
  opponent_hole: string[] | null;
  action_sketch: string;
}

export async function getHistory(
  db: Database,
  userId: string,
  options: HistoryOptions,
): Promise<{ hands: HistoryHandView[]; next_cursor: string | null }> {
  // Build a query for completed hands
  const conditions: ReturnType<typeof sql>[] = [
    sql`h.status = 'complete'`,
  ];

  if (options.matchId) {
    conditions.push(sql`r.match_id = ${options.matchId}`);
  }

  if (options.roundIndex !== undefined) {
    conditions.push(sql`r.round_index = ${options.roundIndex}`);
  }

  if (options.result === 'won') {
    conditions.push(sql`h.winner_user_id = ${userId}`);
  } else if (options.result === 'lost') {
    conditions.push(sql`h.winner_user_id != ${userId} AND h.winner_user_id IS NOT NULL`);
  }

  if (options.favoritesOnly) {
    conditions.push(sql`f.hand_id IS NOT NULL`);
  }

  if (options.cursor) {
    conditions.push(sql`h.completed_at < ${options.cursor}`);
  }

  const whereClause = conditions.map(c => sql`(${c})`).reduce((a, b) => sql`${a} AND ${b}`);

  const result = await db.execute<{
    hand_id: string;
    hand_index: number;
    round_index: number;
    match_id: string;
    board: string;
    pot: number;
    winner_user_id: string | null;
    terminal_reason: string | null;
    completed_at: string | null;
    user_a_hole: string;
    user_b_hole: string;
    user_a_id: string;
    fav_hand_id: string | null;
    sb_user_id: string;
    bb_user_id: string;
  }>(sql`
    SELECT
      h.hand_id, h.hand_index, r.round_index, r.match_id,
      h.board::text, h.pot, h.winner_user_id, h.terminal_reason,
      h.completed_at::text,
      h.user_a_hole::text, h.user_b_hole::text,
      m.user_a_id,
      f.hand_id as fav_hand_id,
      r.sb_user_id, r.bb_user_id
    FROM hands h
    JOIN rounds r ON r.round_id = h.round_id
    JOIN matches m ON m.match_id = r.match_id
    LEFT JOIN favorites f ON f.hand_id = h.hand_id AND f.user_id = ${userId}
    WHERE ${whereClause}
    ORDER BY h.completed_at DESC
    LIMIT ${options.limit + 1}
  `);

  const rows = result as unknown as Array<{
    hand_id: string;
    hand_index: number;
    round_index: number;
    match_id: string;
    board: string;
    pot: number;
    winner_user_id: string | null;
    terminal_reason: string | null;
    completed_at: string | null;
    user_a_hole: string;
    user_b_hole: string;
    user_a_id: string;
    fav_hand_id: string | null;
    sb_user_id: string;
    bb_user_id: string;
  }>;

  const hasMore = rows.length > options.limit;
  const sliced = rows.slice(0, options.limit);

  const handViews: HistoryHandView[] = sliced.map(row => {
    const isUserA = row.user_a_id === userId;
    const myHole = isUserA
      ? JSON.parse(row.user_a_hole) as string[]
      : JSON.parse(row.user_b_hole) as string[];

    let opponentHole: string[] | null = null;
    if (row.terminal_reason === 'showdown') {
      opponentHole = isUserA
        ? JSON.parse(row.user_b_hole) as string[]
        : JSON.parse(row.user_a_hole) as string[];
    }

    return {
      hand_id: row.hand_id,
      hand_index: row.hand_index,
      round_index: row.round_index,
      match_id: row.match_id,
      board: JSON.parse(row.board) as string[],
      pot: row.pot,
      winner_user_id: row.winner_user_id,
      terminal_reason: row.terminal_reason,
      is_favorited: row.fav_hand_id !== null,
      completed_at: row.completed_at,
      my_hole: myHole,
      opponent_hole: opponentHole,
      action_sketch: '', // Will be filled by action sketch generator
    };
  });

  return {
    hands: handViews,
    next_cursor: hasMore ? sliced[sliced.length - 1].completed_at : null,
  };
}

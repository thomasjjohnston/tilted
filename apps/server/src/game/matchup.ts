import { eq, sql, asc } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { matches, users } from '../db/schema.js';
import { USER_TJ_ID, USER_SL_ID } from '../db/seed.js';
import type { Card } from '../engine/types.js';
import { HandCategory } from '../engine/types.js';
import { evaluate } from '../engine/evaluator.js';

// ── Public shape ─────────────────────────────────────────────────────────────

export interface MatchUpView {
  you: UserSummary;
  opponent: UserSummary;
  scoreboard: Scoreboard;
  moments: Moment[];
  head_to_head: HeadToHead;
  pinned_hands: PinnedHand[];
}

interface UserSummary {
  user_id: string;
  display_name: string;
  initials: string;
}

interface Scoreboard {
  matches_won_you: number;
  matches_won_opponent: number;
  current_streak: { who: 'you' | 'opponent' | 'none'; count: number };
  longest_streak: { who: 'you' | 'opponent' | 'none'; count: number };
  hands_played: number;
  last_match_date: string | null;
}

interface Moment {
  kind: 'bad_beat' | 'cooler' | 'biggest_pot' | 'streak_start' | 'milestone';
  hand_id?: string;
  match_index?: number;
  pot_bb: number;
  my_hole?: string[];
  opponent_hole?: string[];
  board?: string[];
  copy: string;
  occurred_at: string;
}

interface HeadToHead {
  vpip_you: number;
  vpip_opponent: number;
  aggression_you: number;
  aggression_opponent: number;
  showdown_win_pct_you: number;
  showdown_win_pct_opponent: number;
  avg_pot_bb: number;
  showdowns: number;
}

interface PinnedHand {
  hand_id: string;
  match_index: number;
  hand_index_in_round: number;
  my_hole: string[];
  opponent_hole: string[] | null;
  board: string[];
  pot: number;
  pot_bb: number;
  winner_user_id: string | null;
  tag: 'cooler' | 'bad_beat' | 'bluff' | 'flush' | 'straight' | 'set' | 'pair' | 'highcard' | 'favorite';
  tag_copy: string;
  favorited_at: string;
}

// ── Entry point ──────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(s => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

export async function getMatchUp(db: Database, userId: string): Promise<MatchUpView> {
  const opponentId = userId === USER_TJ_ID ? USER_SL_ID : USER_TJ_ID;

  const [youUser, oppUser] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.userId, userId) }),
    db.query.users.findFirst({ where: eq(users.userId, opponentId) }),
  ]);
  if (!youUser || !oppUser) throw new Error('Users not found');

  const [scoreboard, headToHead, moments, pinnedHands] = await Promise.all([
    computeScoreboard(db, userId, opponentId),
    computeHeadToHead(db, userId, opponentId),
    computeMoments(db, userId, oppUser.displayName),
    computePinnedHands(db, userId),
  ]);

  return {
    you: { user_id: youUser.userId, display_name: youUser.displayName, initials: initials(youUser.displayName) },
    opponent: { user_id: oppUser.userId, display_name: oppUser.displayName, initials: initials(oppUser.displayName) },
    scoreboard,
    moments,
    head_to_head: headToHead,
    pinned_hands: pinnedHands,
  };
}

// ── Scoreboard ───────────────────────────────────────────────────────────────

async function computeScoreboard(db: Database, userId: string, opponentId: string): Promise<Scoreboard> {
  const endedMatches = await db.query.matches.findMany({
    where: eq(matches.status, 'ended'),
    orderBy: asc(matches.endedAt),
  });

  let wonYou = 0;
  let wonOpp = 0;
  let lastDate: Date | null = null;
  for (const m of endedMatches) {
    if (!m.winnerUserId) continue;
    if (m.winnerUserId === userId) wonYou++;
    else if (m.winnerUserId === opponentId) wonOpp++;
    if (m.endedAt && (!lastDate || m.endedAt > lastDate)) lastDate = m.endedAt;
  }

  // Streaks (ignoring ties — winner_user_id null — as non-terminal outcomes)
  const winners = endedMatches
    .map(m => m.winnerUserId)
    .filter((w): w is string => !!w);

  let currentStreak: Scoreboard['current_streak'] = { who: 'none', count: 0 };
  if (winners.length > 0) {
    const last = winners[winners.length - 1];
    let run = 1;
    for (let i = winners.length - 2; i >= 0; i--) {
      if (winners[i] === last) run++;
      else break;
    }
    currentStreak = {
      who: last === userId ? 'you' : 'opponent',
      count: run,
    };
  }

  let longestStreak: Scoreboard['longest_streak'] = { who: 'none', count: 0 };
  if (winners.length > 0) {
    let run = 1;
    let bestRun = 1;
    let bestOwner = winners[0];
    let current = winners[0];
    for (let i = 1; i < winners.length; i++) {
      if (winners[i] === current) {
        run++;
        if (run > bestRun) {
          bestRun = run;
          bestOwner = current;
        }
      } else {
        current = winners[i];
        run = 1;
      }
    }
    longestStreak = {
      who: bestOwner === userId ? 'you' : 'opponent',
      count: bestRun,
    };
  }

  // Hands played = distinct completed hands across all matches (ended OR active)
  const handsPlayedRow = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM hands WHERE status = 'complete'`,
  );
  const handsPlayed = Number((handsPlayedRow as unknown as Array<{ count: string }>)[0]?.count ?? 0);

  return {
    matches_won_you: wonYou,
    matches_won_opponent: wonOpp,
    current_streak: currentStreak,
    longest_streak: longestStreak,
    hands_played: handsPlayed,
    last_match_date: lastDate ? lastDate.toISOString() : null,
  };
}

// ── Head-to-head ─────────────────────────────────────────────────────────────

async function computeHeadToHead(db: Database, userId: string, opponentId: string): Promise<HeadToHead> {
  // Pull every action joined with hand+round+match in one query.
  const rows = await db.execute<{
    hand_id: string;
    action_type: string;
    acting_user_id: string;
    street: string;
    hand_pot: number;
    blind_big: number;
    hand_status: string;
    terminal_reason: string | null;
    winner_user_id: string | null;
  }>(sql`
    SELECT
      h.hand_id,
      a.action_type,
      a.acting_user_id,
      a.street,
      h.pot AS hand_pot,
      m.blind_big,
      h.status AS hand_status,
      h.terminal_reason,
      h.winner_user_id
    FROM actions a
    JOIN hands h ON h.hand_id = a.hand_id
    JOIN rounds r ON r.round_id = h.round_id
    JOIN matches m ON m.match_id = r.match_id
  `);

  interface Row {
    hand_id: string;
    action_type: string;
    acting_user_id: string;
    street: string;
    hand_pot: number;
    blind_big: number;
    hand_status: string;
    terminal_reason: string | null;
    winner_user_id: string | null;
  }
  const allRows = rows as unknown as Row[];

  // VPIP: hands where user put money in voluntarily preflop (call/raise/all_in; NOT check or fold).
  // Denominator = hands user saw preflop.
  const sawPreflop = { [userId]: new Set<string>(), [opponentId]: new Set<string>() } as Record<string, Set<string>>;
  const didVpipHand = { [userId]: new Set<string>(), [opponentId]: new Set<string>() } as Record<string, Set<string>>;

  // Aggression: (bets + raises + all_ins) / calls per user across all streets.
  const aggressiveCount = { [userId]: 0, [opponentId]: 0 } as Record<string, number>;
  const callCount = { [userId]: 0, [opponentId]: 0 } as Record<string, number>;

  // Showdowns: count of hands where terminal_reason='showdown'.
  // Showdown wins per user: subset where winner_user_id = user.
  const showdownHands = new Set<string>();
  const showdownWins = { [userId]: 0, [opponentId]: 0 } as Record<string, number>;

  // Pot averages (BB) across completed hands.
  const handPotBb = new Map<string, number>();

  for (const r of allRows) {
    if (r.street === 'preflop' && sawPreflop[r.acting_user_id]) {
      sawPreflop[r.acting_user_id].add(r.hand_id);
      if (r.action_type === 'call' || r.action_type === 'raise' || r.action_type === 'all_in') {
        didVpipHand[r.acting_user_id].add(r.hand_id);
      }
    }
    if (r.action_type === 'bet' || r.action_type === 'raise' || r.action_type === 'all_in') {
      aggressiveCount[r.acting_user_id]++;
    } else if (r.action_type === 'call') {
      callCount[r.acting_user_id]++;
    }
    if (r.hand_status === 'complete' && r.terminal_reason === 'showdown') {
      showdownHands.add(r.hand_id);
      if (r.winner_user_id === userId) showdownWins[userId] = showdownWins[userId] ?? 0;
      if (r.winner_user_id === opponentId) showdownWins[opponentId] = showdownWins[opponentId] ?? 0;
    }
    if (r.hand_status === 'complete' && r.blind_big > 0) {
      handPotBb.set(r.hand_id, r.hand_pot / r.blind_big);
    }
  }

  // Actual showdown-win counting (once per hand)
  const handWinners = new Map<string, string | null>();
  for (const r of allRows) {
    if (r.hand_status === 'complete' && r.terminal_reason === 'showdown') {
      handWinners.set(r.hand_id, r.winner_user_id);
    }
  }
  let youWins = 0;
  let oppWins = 0;
  for (const [, winner] of handWinners) {
    if (winner === userId) youWins++;
    else if (winner === opponentId) oppWins++;
  }

  const pct = (num: number, denom: number) => (denom > 0 ? (num / denom) * 100 : 0);
  const ratio = (num: number, denom: number) => (denom > 0 ? num / denom : num > 0 ? num : 0);

  const avgPotBb = handPotBb.size > 0
    ? [...handPotBb.values()].reduce((a, b) => a + b, 0) / handPotBb.size
    : 0;

  return {
    vpip_you: pct(didVpipHand[userId].size, sawPreflop[userId].size),
    vpip_opponent: pct(didVpipHand[opponentId].size, sawPreflop[opponentId].size),
    aggression_you: ratio(aggressiveCount[userId], callCount[userId]),
    aggression_opponent: ratio(aggressiveCount[opponentId], callCount[opponentId]),
    showdown_win_pct_you: pct(youWins, showdownHands.size),
    showdown_win_pct_opponent: pct(oppWins, showdownHands.size),
    avg_pot_bb: avgPotBb,
    showdowns: showdownHands.size,
  };
}

// ── Moments ──────────────────────────────────────────────────────────────────

interface HandSnapshot {
  hand_id: string;
  hand_index: number;
  pot: number;
  blind_big: number;
  winner_user_id: string | null;
  user_a_hole: string;
  user_b_hole: string;
  user_a_id: string;
  board: string;
  match_index: number;
  completed_at: string | null;
  terminal_reason: string | null;
}

async function computeMoments(
  db: Database,
  userId: string,
  opponentDisplayName: string,
): Promise<Moment[]> {
  // Pull every completed hand we'll need to rank.
  const raw = await db.execute<{
    hand_id: string;
    hand_index: number;
    pot: number;
    blind_big: number;
    winner_user_id: string | null;
    user_a_hole: string;
    user_b_hole: string;
    user_a_id: string;
    board: string;
    match_index_raw: string;
    completed_at: string | null;
    terminal_reason: string | null;
  }>(sql`
    SELECT
      h.hand_id, h.hand_index, h.pot, m.blind_big, h.winner_user_id,
      h.user_a_hole::text, h.user_b_hole::text, m.user_a_id,
      h.board::text,
      DENSE_RANK() OVER (ORDER BY m.started_at)::text AS match_index_raw,
      h.completed_at::text, h.terminal_reason
    FROM hands h
    JOIN rounds r ON r.round_id = h.round_id
    JOIN matches m ON m.match_id = r.match_id
    WHERE h.status = 'complete' AND m.blind_big > 0
    ORDER BY h.completed_at DESC
  `);

  const allRows = (raw as unknown as Array<{
    hand_id: string;
    hand_index: number;
    pot: number;
    blind_big: number;
    winner_user_id: string | null;
    user_a_hole: string;
    user_b_hole: string;
    user_a_id: string;
    board: string;
    match_index_raw: string;
    completed_at: string | null;
    terminal_reason: string | null;
  }>).map<HandSnapshot>(r => ({
    hand_id: r.hand_id,
    hand_index: r.hand_index,
    pot: r.pot,
    blind_big: r.blind_big,
    winner_user_id: r.winner_user_id,
    user_a_hole: r.user_a_hole,
    user_b_hole: r.user_b_hole,
    user_a_id: r.user_a_id,
    board: r.board,
    match_index: Number(r.match_index_raw),
    completed_at: r.completed_at,
    terminal_reason: r.terminal_reason,
  }));

  if (allRows.length === 0) return [];

  const moments: Moment[] = [];
  const usedHandIds = new Set<string>();
  const oppFirst = firstName(opponentDisplayName);

  // Biggest pot: single largest pot-in-BB across all completed hands.
  const biggestPot = [...allRows].sort((a, b) => (b.pot / b.blind_big) - (a.pot / a.blind_big))[0];
  if (biggestPot) {
    moments.push(buildMoment(biggestPot, userId, oppFirst, 'biggest_pot'));
    usedHandIds.add(biggestPot.hand_id);
  }

  // Bad beat: most recent showdown where loser had trips or better.
  const showdownRows = allRows.filter(r => r.terminal_reason === 'showdown' && (JSON.parse(r.board) as string[]).length === 5);
  const badBeat = showdownRows.find(r => {
    if (usedHandIds.has(r.hand_id)) return false;
    const { loserCat } = evaluateShowdown(r);
    return loserCat >= HandCategory.ThreeOfAKind;
  });
  if (badBeat) {
    moments.push(buildMoment(badBeat, userId, oppFirst, 'bad_beat'));
    usedHandIds.add(badBeat.hand_id);
  }

  // Cooler: most recent showdown where winner ≥ loser+2 categories AND loser ≥ two pair.
  const cooler = showdownRows.find(r => {
    if (usedHandIds.has(r.hand_id)) return false;
    const { winnerCat, loserCat } = evaluateShowdown(r);
    return loserCat >= HandCategory.TwoPair && winnerCat >= loserCat + 2;
  });
  if (cooler) {
    moments.push(buildMoment(cooler, userId, oppFirst, 'cooler'));
    usedHandIds.add(cooler.hand_id);
  }

  // Fall-backs (only if we have < 3 moments):
  //   streak_start: most recent terminal match we have
  //   milestone: hands_played thresholds (100, 500, 1000)
  if (moments.length < 3) {
    const milestoneThreshold = nearestMilestone(allRows.length);
    if (milestoneThreshold) {
      const mostRecent = allRows[0];
      moments.push({
        kind: 'milestone',
        hand_id: undefined,
        match_index: mostRecent.match_index,
        pot_bb: 0,
        copy: `${milestoneThreshold} hands played — keep going.`,
        occurred_at: mostRecent.completed_at ?? new Date().toISOString(),
      });
    }
  }

  return moments;
}

function evaluateShowdown(r: HandSnapshot): { winnerCat: HandCategory; loserCat: HandCategory } {
  const aHole = JSON.parse(r.user_a_hole) as Card[];
  const bHole = JSON.parse(r.user_b_hole) as Card[];
  const board = JSON.parse(r.board) as Card[];
  const aRank = evaluate(aHole, board);
  const bRank = evaluate(bHole, board);
  const aWon = r.winner_user_id === r.user_a_id;
  const bWon = r.winner_user_id !== null && !aWon;
  const winnerCat = aWon ? aRank.category : bWon ? bRank.category : Math.max(aRank.category, bRank.category);
  const loserCat = aWon ? bRank.category : bWon ? aRank.category : Math.min(aRank.category, bRank.category);
  return { winnerCat, loserCat };
}

function buildMoment(
  r: HandSnapshot,
  userId: string,
  opponentFirst: string,
  kind: Moment['kind'],
): Moment {
  const isUserA = r.user_a_id === userId;
  const myHole = JSON.parse(isUserA ? r.user_a_hole : r.user_b_hole) as string[];
  const oppHole = JSON.parse(isUserA ? r.user_b_hole : r.user_a_hole) as string[];
  const board = JSON.parse(r.board) as string[];
  const potBb = Math.round(r.pot / r.blind_big);
  const winnerIsYou = r.winner_user_id === userId;
  const winnerName = winnerIsYou ? 'You' : opponentFirst;
  const loserName = winnerIsYou ? opponentFirst : 'You';

  let copy = '';
  if (kind === 'biggest_pot') {
    copy = `Biggest pot — ${winnerName} took ${potBb} BB`;
  } else if (r.terminal_reason === 'showdown' && board.length === 5) {
    const myRank = evaluate(myHole as Card[], board as Card[]);
    const oppRank = evaluate(oppHole as Card[], board as Card[]);
    const winnerRank = winnerIsYou ? myRank : oppRank;
    const loserRank = winnerIsYou ? oppRank : myRank;
    if (kind === 'bad_beat') {
      copy = `${loserName}'s ${loserRank.name} lost to ${winnerRank.name}`;
    } else if (kind === 'cooler') {
      copy = `${winnerRank.name} over ${loserRank.name} (${potBb} BB)`;
    } else {
      copy = `${winnerRank.name} — ${potBb} BB`;
    }
  } else {
    copy = `${winnerName} won ${potBb} BB`;
  }

  return {
    kind,
    hand_id: r.hand_id,
    match_index: r.match_index,
    pot_bb: potBb,
    my_hole: myHole,
    opponent_hole: r.terminal_reason === 'showdown' ? oppHole : undefined,
    board,
    copy,
    occurred_at: r.completed_at ?? new Date().toISOString(),
  };
}

function nearestMilestone(count: number): number | null {
  for (const t of [1000, 500, 100] as const) {
    if (count >= t) return t;
  }
  return null;
}

// ── Pinned hands ─────────────────────────────────────────────────────────────

async function computePinnedHands(db: Database, userId: string): Promise<PinnedHand[]> {
  const rows = await db.execute<{
    hand_id: string;
    hand_index: number;
    round_index: number;
    match_started_at: string;
    user_a_hole: string;
    user_b_hole: string;
    user_a_id: string;
    board: string;
    pot: number;
    blind_big: number;
    winner_user_id: string | null;
    terminal_reason: string | null;
    favorited_at: string;
  }>(sql`
    SELECT
      h.hand_id, h.hand_index, r.round_index,
      m.started_at::text AS match_started_at,
      h.user_a_hole::text, h.user_b_hole::text, m.user_a_id,
      h.board::text, h.pot, m.blind_big,
      h.winner_user_id, h.terminal_reason,
      f.created_at::text AS favorited_at,
      ROW_NUMBER() OVER (ORDER BY m.started_at) AS match_index_raw
    FROM favorites f
    JOIN hands h ON h.hand_id = f.hand_id
    JOIN rounds r ON r.round_id = h.round_id
    JOIN matches m ON m.match_id = r.match_id
    WHERE f.user_id = ${userId}
    ORDER BY f.created_at DESC
    LIMIT 20
  `);

  const list = rows as unknown as Array<{
    hand_id: string;
    hand_index: number;
    round_index: number;
    match_started_at: string;
    user_a_hole: string;
    user_b_hole: string;
    user_a_id: string;
    board: string;
    pot: number;
    blind_big: number;
    winner_user_id: string | null;
    terminal_reason: string | null;
    favorited_at: string;
    match_index_raw: string;
  }>;

  return list.map(r => {
    const isUserA = r.user_a_id === userId;
    const myHole = (isUserA ? JSON.parse(r.user_a_hole) : JSON.parse(r.user_b_hole)) as string[];
    const oppHole = (isUserA ? JSON.parse(r.user_b_hole) : JSON.parse(r.user_a_hole)) as string[];
    const board = JSON.parse(r.board) as string[];
    const potBb = r.blind_big > 0 ? Math.round(r.pot / r.blind_big) : 0;

    const showdown = r.terminal_reason === 'showdown';
    const { tag, tagCopy } = classifyPinnedTag(myHole, oppHole, board, showdown, potBb);

    return {
      hand_id: r.hand_id,
      match_index: Number(r.match_index_raw),
      hand_index_in_round: r.hand_index,
      my_hole: myHole,
      opponent_hole: showdown ? oppHole : null,
      board,
      pot: r.pot,
      pot_bb: potBb,
      winner_user_id: r.winner_user_id,
      tag,
      tag_copy: tagCopy,
      favorited_at: r.favorited_at,
    };
  });
}

function classifyPinnedTag(
  myHole: string[],
  oppHole: string[],
  board: string[],
  wasShowdown: boolean,
  potBb: number,
): { tag: PinnedHand['tag']; tagCopy: string } {
  if (!wasShowdown || board.length < 5) {
    return { tag: 'favorite', tagCopy: `${potBb} BB pot` };
  }

  const myRank = evaluate(myHole as Card[], board as Card[]);
  const oppRank = evaluate(oppHole as Card[], board as Card[]);
  const loserCategory = Math.min(myRank.category, oppRank.category);
  const winnerCategory = Math.max(myRank.category, oppRank.category);

  // Bad beat = loser had trips or better.
  if (loserCategory >= HandCategory.ThreeOfAKind) {
    return { tag: 'bad_beat', tagCopy: `${potBb} BB bad beat` };
  }

  // Cooler = both two-pair-or-better and winner ≥ loser+2 categories.
  if (loserCategory >= HandCategory.TwoPair && winnerCategory >= loserCategory + 2) {
    return { tag: 'cooler', tagCopy: `${potBb} BB cooler` };
  }

  // Category-specific tags based on the winning hand
  switch (winnerCategory) {
    case HandCategory.RoyalFlush:
    case HandCategory.StraightFlush:
    case HandCategory.Flush:
      return { tag: 'flush', tagCopy: `${potBb} BB flush` };
    case HandCategory.Straight:
      return { tag: 'straight', tagCopy: `${potBb} BB straight` };
    case HandCategory.FourOfAKind:
    case HandCategory.FullHouse:
    case HandCategory.ThreeOfAKind:
      return { tag: 'set', tagCopy: `${potBb} BB set` };
    case HandCategory.TwoPair:
    case HandCategory.Pair:
      return { tag: 'pair', tagCopy: `${potBb} BB pair` };
    default:
      return { tag: 'highcard', tagCopy: `${potBb} BB pot` };
  }
}

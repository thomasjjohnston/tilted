import { type Card, type Rank, type Suit, HandCategory, type HandRank, RANKS } from './types.js';

// ── Card parsing ─────────────────────────────────────────────────────────────

const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

function parseCard(card: Card): { rank: Rank; suit: Suit; value: number } {
  const rank = card[0] as Rank;
  const suit = card[1] as Suit;
  return { rank, suit, value: RANK_VALUE[rank] };
}

// ── Combination generation ───────────────────────────────────────────────────

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

// ── 5-card hand evaluation ───────────────────────────────────────────────────

interface ParsedHand {
  values: number[];
  suits: Suit[];
}

function parse5(cards: Card[]): ParsedHand {
  const parsed = cards.map(parseCard);
  return {
    values: parsed.map(c => c.value).sort((a, b) => b - a),
    suits: parsed.map(c => c.suit),
  };
}

function isFlush(suits: Suit[]): boolean {
  return suits.every(s => s === suits[0]);
}

function isStraight(values: number[]): { is: boolean; highCard: number } {
  const sorted = [...new Set(values)].sort((a, b) => b - a);
  if (sorted.length < 5) return { is: false, highCard: 0 };

  // Normal straight check
  if (sorted[0] - sorted[4] === 4 && sorted.length === 5) {
    return { is: true, highCard: sorted[0] };
  }

  // Wheel (A-2-3-4-5): Ace plays low
  if (sorted[0] === 14 && sorted[1] === 5 && sorted[2] === 4 && sorted[3] === 3 && sorted[4] === 2) {
    return { is: true, highCard: 5 };
  }

  return { is: false, highCard: 0 };
}

function getGroupings(values: number[]): Map<number, number> {
  const groups = new Map<number, number>();
  for (const v of values) {
    groups.set(v, (groups.get(v) ?? 0) + 1);
  }
  return groups;
}

function evaluate5(cards: Card[]): HandRank {
  const { values, suits } = parse5(cards);
  const flush = isFlush(suits);
  const straight = isStraight(values);
  const groups = getGroupings(values);

  // Sort groups by count desc, then value desc
  const groupEntries = [...groups.entries()].sort((a, b) =>
    b[1] - a[1] || b[0] - a[0]
  );

  const counts = groupEntries.map(e => e[1]);
  const groupValues = groupEntries.map(e => e[0]);

  // Royal Flush
  if (flush && straight.is && straight.highCard === 14) {
    return { category: HandCategory.RoyalFlush, rankValues: [14], name: 'Royal Flush' };
  }

  // Straight Flush
  if (flush && straight.is) {
    return {
      category: HandCategory.StraightFlush,
      rankValues: [straight.highCard],
      name: `Straight Flush, ${rankName(straight.highCard)} high`,
    };
  }

  // Four of a Kind
  if (counts[0] === 4) {
    return {
      category: HandCategory.FourOfAKind,
      rankValues: groupValues,
      name: `Four of a Kind, ${rankName(groupValues[0])}s`,
    };
  }

  // Full House
  if (counts[0] === 3 && counts[1] === 2) {
    return {
      category: HandCategory.FullHouse,
      rankValues: groupValues,
      name: `Full House, ${rankName(groupValues[0])}s full of ${rankName(groupValues[1])}s`,
    };
  }

  // Flush
  if (flush) {
    return {
      category: HandCategory.Flush,
      rankValues: values,
      name: `Flush, ${rankName(values[0])} high`,
    };
  }

  // Straight
  if (straight.is) {
    return {
      category: HandCategory.Straight,
      rankValues: [straight.highCard],
      name: `Straight, ${rankName(straight.highCard)} high`,
    };
  }

  // Three of a Kind
  if (counts[0] === 3) {
    return {
      category: HandCategory.ThreeOfAKind,
      rankValues: groupValues,
      name: `Three of a Kind, ${rankName(groupValues[0])}s`,
    };
  }

  // Two Pair
  if (counts[0] === 2 && counts[1] === 2) {
    return {
      category: HandCategory.TwoPair,
      rankValues: groupValues,
      name: `Two Pair, ${rankName(groupValues[0])}s and ${rankName(groupValues[1])}s`,
    };
  }

  // One Pair
  if (counts[0] === 2) {
    return {
      category: HandCategory.Pair,
      rankValues: groupValues,
      name: `Pair of ${rankName(groupValues[0])}s`,
    };
  }

  // High Card
  return {
    category: HandCategory.HighCard,
    rankValues: values,
    name: `${rankName(values[0])} high`,
  };
}

function rankName(value: number): string {
  const names: Record<number, string> = {
    2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six',
    7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack',
    12: 'Queen', 13: 'King', 14: 'Ace',
  };
  return names[value] ?? String(value);
}

// ── Best 5 from 7 cards ─────────────────────────────────────────────────────

/**
 * Evaluate the best 5-card hand from any number of cards (typically 7: 2 hole + 5 board).
 */
export function evaluate(holeCards: Card[], board: Card[]): HandRank {
  const allCards = [...holeCards, ...board];
  if (allCards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${allCards.length}`);
  }

  const combos = combinations(allCards, 5);
  let best: HandRank | null = null;

  for (const combo of combos) {
    const rank = evaluate5(combo as [Card, Card, Card, Card, Card]);
    if (!best || compareHands(rank, best) > 0) {
      best = rank;
    }
  }

  return best!;
}

/**
 * Compare two hand ranks. Returns:
 *   > 0 if a wins
 *   < 0 if b wins
 *   0 if tie
 */
export function compareHands(a: HandRank, b: HandRank): number {
  if (a.category !== b.category) {
    return a.category - b.category;
  }

  // Compare rank values lexicographically
  for (let i = 0; i < Math.min(a.rankValues.length, b.rankValues.length); i++) {
    if (a.rankValues[i] !== b.rankValues[i]) {
      return a.rankValues[i] - b.rankValues[i];
    }
  }

  return 0;
}

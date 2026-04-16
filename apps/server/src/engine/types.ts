// ── Card types ───────────────────────────────────────────────────────────────

export const SUITS = ['h', 'd', 'c', 's'] as const;
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;

export type Suit = typeof SUITS[number];
export type Rank = typeof RANKS[number];

/** Card as a 2-char string: rank + suit, e.g. "Ah", "Td", "2c" */
export type Card = `${Rank}${Suit}`;

export const ALL_CARDS: Card[] = RANKS.flatMap(
  r => SUITS.map(s => `${r}${s}` as Card)
);

// ── Hand evaluation ──────────────────────────────────────────────────────────

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

export interface HandRank {
  category: HandCategory;
  /** Higher = better. Comparable within same category via numeric ordering. */
  rankValues: number[];
  /** Human-readable name, e.g. "Pair of Aces" */
  name: string;
}

// ── Betting ──────────────────────────────────────────────────────────────────

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';

export interface Action {
  type: ActionType;
  amount: number; // 0 for fold/check
}

export interface PlayerState {
  userId: string;
  /** Total chips available (not in any pot) at the START of this action */
  available: number;
  /** Chips already committed to THIS hand's pot */
  reservedInHand: number;
  /** Whether this player is all-in */
  isAllIn: boolean;
}

export interface BettingState {
  street: Street;
  pot: number;
  /** Current bet level on this street (e.g., if BB posts 10 preflop, currentBet=10) */
  currentBet: number;
  /** Last raise size (for min-raise calculation) */
  lastRaiseSize: number;
  /** Who is SB (acts first preflop, second postflop) */
  sbUserId: string;
  /** Who is BB (acts second preflop, first postflop) */
  bbUserId: string;
  /** Whose turn it is to act */
  actionOnUserId: string;
  /** Players' states */
  players: [PlayerState, PlayerState];
  /** Number of actions taken on this street */
  actionsThisStreet: number;
  /** Whether the street is closed (both players have acted and bets are equal) */
  streetClosed: boolean;
  /** Whether the hand is terminal */
  isTerminal: boolean;
  /** Terminal reason if hand is over */
  terminalReason?: 'fold' | 'showdown';
  /** Winner if hand is terminal */
  winnerUserId?: string;
}

export interface LegalActionsResult {
  actions: ActionType[];
  minRaise: number;
  maxBet: number;
  callAmount: number;
  potSize: number;
}

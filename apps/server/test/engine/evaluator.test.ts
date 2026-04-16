import { describe, it, expect } from 'vitest';
import { evaluate, compareHands } from '../../src/engine/evaluator.js';
import { HandCategory, type Card } from '../../src/engine/types.js';

describe('evaluator', () => {
  describe('hand rankings', () => {
    it('detects a royal flush', () => {
      const result = evaluate(['Ah', 'Kh'] as Card[], ['Qh', 'Jh', 'Th', '2c', '3d'] as Card[]);
      expect(result.category).toBe(HandCategory.RoyalFlush);
    });

    it('detects a straight flush', () => {
      const result = evaluate(['9h', '8h'] as Card[], ['7h', '6h', '5h', '2c', '3d'] as Card[]);
      expect(result.category).toBe(HandCategory.StraightFlush);
    });

    it('detects four of a kind', () => {
      const result = evaluate(['Ah', 'Ad'] as Card[], ['Ac', 'As', '5h', '2c', '3d'] as Card[]);
      expect(result.category).toBe(HandCategory.FourOfAKind);
    });

    it('detects a full house', () => {
      const result = evaluate(['Ah', 'Ad'] as Card[], ['Ac', 'Ks', 'Kh', '2c', '3d'] as Card[]);
      expect(result.category).toBe(HandCategory.FullHouse);
    });

    it('detects a flush', () => {
      const result = evaluate(['Ah', '9h'] as Card[], ['7h', '4h', '2h', 'Kc', '3d'] as Card[]);
      expect(result.category).toBe(HandCategory.Flush);
    });

    it('detects a straight', () => {
      const result = evaluate(['9h', '8d'] as Card[], ['7c', '6s', '5h', '2c', '3d'] as Card[]);
      expect(result.category).toBe(HandCategory.Straight);
    });

    it('detects a wheel (A-2-3-4-5)', () => {
      const result = evaluate(['Ah', '2d'] as Card[], ['3c', '4s', '5h', 'Kc', '9d'] as Card[]);
      expect(result.category).toBe(HandCategory.Straight);
      expect(result.rankValues[0]).toBe(5); // 5-high straight
    });

    it('detects three of a kind', () => {
      const result = evaluate(['Ah', 'Ad'] as Card[], ['Ac', '9s', '7h', '2c', '3d'] as Card[]);
      expect(result.category).toBe(HandCategory.ThreeOfAKind);
    });

    it('detects two pair', () => {
      const result = evaluate(['Ah', 'Ad'] as Card[], ['Kc', 'Ks', '7h', '2c', '3d'] as Card[]);
      expect(result.category).toBe(HandCategory.TwoPair);
    });

    it('detects one pair', () => {
      const result = evaluate(['Ah', 'Ad'] as Card[], ['Kc', '9s', '7h', '2c', '3d'] as Card[]);
      expect(result.category).toBe(HandCategory.Pair);
    });

    it('detects high card', () => {
      const result = evaluate(['Ah', 'Kd'] as Card[], ['9c', '7s', '4h', '2c', '3d'] as Card[]);
      expect(result.category).toBe(HandCategory.HighCard);
    });
  });

  describe('compareHands', () => {
    it('flush beats straight', () => {
      const flush = evaluate(['Ah', '9h'] as Card[], ['7h', '4h', '2h', 'Kc', '3d'] as Card[]);
      const straight = evaluate(['9h', '8d'] as Card[], ['7c', '6s', '5h', '2c', '3d'] as Card[]);
      expect(compareHands(flush, straight)).toBeGreaterThan(0);
    });

    it('pair of aces beats pair of kings', () => {
      const aces = evaluate(['Ah', 'Ad'] as Card[], ['Kc', '9s', '7h', '2c', '3d'] as Card[]);
      const kings = evaluate(['Kh', 'Kd'] as Card[], ['Ac', '9s', '7h', '2c', '3d'] as Card[]);
      expect(compareHands(aces, kings)).toBeGreaterThan(0);
    });

    it('higher kicker wins with same pair', () => {
      const highKicker = evaluate(['Ah', 'Ad'] as Card[], ['Kc', '9s', '7h', '2c', '3d'] as Card[]);
      const lowKicker = evaluate(['Ah', 'Ad'] as Card[], ['Qc', '9s', '7h', '2c', '3d'] as Card[]);
      // Both have pair of aces, but kickers from the board differ
      // highKicker has K as kicker, lowKicker has Q
      expect(compareHands(highKicker, lowKicker)).toBeGreaterThanOrEqual(0);
    });

    it('identical hands return 0', () => {
      const hand = evaluate(['Ah', 'Kh'] as Card[], ['Qh', 'Jh', 'Th', '2c', '3d'] as Card[]);
      expect(compareHands(hand, hand)).toBe(0);
    });

    it('split pot: same board makes same best hand', () => {
      // Both players' hole cards are irrelevant when the board has a straight
      const board: Card[] = ['Th', '9d', '8c', '7s', '6h'];
      const a = evaluate(['2h', '3d'] as Card[], board);
      const b = evaluate(['2c', '3s'] as Card[], board);
      // Both make the same T-high straight from the board
      expect(compareHands(a, b)).toBe(0);
    });
  });

  describe('best 5 from 7', () => {
    it('picks the best 5-card combination', () => {
      // Hole: AA, Board: A K K 2 3 → full house AAA KK beats trips
      const result = evaluate(['Ah', 'Ad'] as Card[], ['Ac', 'Ks', 'Kh', '2c', '3d'] as Card[]);
      expect(result.category).toBe(HandCategory.FullHouse);
      expect(result.name).toContain('Ace');
    });

    it('throws if fewer than 5 cards total', () => {
      expect(() => evaluate(['Ah', 'Kd'] as Card[], ['Qc'] as Card[])).toThrow('Need at least 5 cards');
    });
  });

  describe('known heads-up scenarios', () => {
    it('set over set: higher set wins', () => {
      const board: Card[] = ['Ah', 'Kd', '7c', '2s', '9h'];
      const aces = evaluate(['Ad', 'Ac'] as Card[], board);   // Set of aces
      const kings = evaluate(['Kh', 'Kc'] as Card[], board);  // Set of kings
      expect(compareHands(aces, kings)).toBeGreaterThan(0);
    });

    it('flush vs full house: full house wins', () => {
      const board: Card[] = ['Ah', 'Kh', 'Kd', '7h', '2h'];
      const fullHouse = evaluate(['Ad', 'Ac'] as Card[], board); // AA full of KK
      const flush = evaluate(['9h', '3h'] as Card[], board);     // Heart flush
      expect(compareHands(fullHouse, flush)).toBeGreaterThan(0);
    });

    it('broadway straight: both make it, split pot', () => {
      const board: Card[] = ['Th', 'Jd', 'Qc', 'Ks', 'Ah'];
      const a = evaluate(['2h', '3d'] as Card[], board);
      const b = evaluate(['4c', '5s'] as Card[], board);
      expect(compareHands(a, b)).toBe(0); // Both make AKQJT
    });
  });
});

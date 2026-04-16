import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { shuffleDeck, dealFromSeed, boardForStreet, generateSeed } from '../../src/engine/deck.js';
import { ALL_CARDS } from '../../src/engine/types.js';

describe('deck', () => {
  describe('shuffleDeck', () => {
    it('produces 52 unique cards', () => {
      const deck = shuffleDeck('test-seed');
      expect(deck).toHaveLength(52);
      expect(new Set(deck).size).toBe(52);
    });

    it('same seed → same deck (deterministic)', () => {
      const a = shuffleDeck('deterministic-seed-123');
      const b = shuffleDeck('deterministic-seed-123');
      expect(a).toEqual(b);
    });

    it('different seeds → different decks', () => {
      const a = shuffleDeck('seed-a');
      const b = shuffleDeck('seed-b');
      expect(a).not.toEqual(b);
    });

    it('(property) every card in the standard 52-card deck appears exactly once', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 32 }), (seed) => {
          const deck = shuffleDeck(seed);
          expect(deck).toHaveLength(52);
          const sorted = [...deck].sort();
          const expected = [...ALL_CARDS].sort();
          expect(sorted).toEqual(expected);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('dealFromSeed', () => {
    it('deals 2 hole cards per player + flop + turn + river', () => {
      const deal = dealFromSeed('deal-test');
      expect(deal.userAHole).toHaveLength(2);
      expect(deal.userBHole).toHaveLength(2);
      expect(deal.flop).toHaveLength(3);
      expect(deal.turn).toBeTruthy();
      expect(deal.river).toBeTruthy();
    });

    it('no card appears twice in the deal', () => {
      const deal = dealFromSeed('unique-test');
      const allDealt = [
        ...deal.userAHole,
        ...deal.userBHole,
        ...deal.flop,
        deal.turn,
        deal.river,
      ];
      expect(new Set(allDealt).size).toBe(allDealt.length);
    });

    it('same seed → same deal (deterministic)', () => {
      const a = dealFromSeed('same-deal');
      const b = dealFromSeed('same-deal');
      expect(a).toEqual(b);
    });
  });

  describe('boardForStreet', () => {
    const deal = dealFromSeed('board-test');

    it('preflop → empty board', () => {
      expect(boardForStreet(deal, 'preflop')).toEqual([]);
    });

    it('flop → 3 cards', () => {
      const board = boardForStreet(deal, 'flop');
      expect(board).toHaveLength(3);
      expect(board).toEqual([...deal.flop]);
    });

    it('turn → 4 cards (flop + turn)', () => {
      const board = boardForStreet(deal, 'turn');
      expect(board).toHaveLength(4);
      expect(board).toEqual([...deal.flop, deal.turn]);
    });

    it('river → 5 cards (flop + turn + river)', () => {
      const board = boardForStreet(deal, 'river');
      expect(board).toHaveLength(5);
      expect(board).toEqual([...deal.flop, deal.turn, deal.river]);
    });
  });

  describe('generateSeed', () => {
    it('produces a 16-char alphanumeric string', () => {
      const seed = generateSeed();
      expect(seed).toHaveLength(16);
      expect(seed).toMatch(/^[a-z0-9]+$/);
    });

    it('generates unique seeds', () => {
      const seeds = new Set(Array.from({ length: 100 }, generateSeed));
      expect(seeds.size).toBe(100);
    });
  });
});

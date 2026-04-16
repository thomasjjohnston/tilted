import { describe, it, expect } from 'vitest';
import { resolveShowdown } from '../../src/engine/showdown.js';
import type { Card } from '../../src/engine/types.js';

const USER_A = 'user-a';
const USER_B = 'user-b';
const BB_USER = USER_B; // B is BB (out of position)

describe('showdown', () => {
  it('higher hand wins the pot', () => {
    const board: Card[] = ['Th', '9d', '2c', '7s', '3h'];
    const result = resolveShowdown(
      ['Ah', 'Kd'] as Card[], // A has AK high
      ['Qh', 'Jd'] as Card[], // B has QJ high
      board,
      100,
      USER_A, USER_B, BB_USER,
    );
    expect(result.winnerUserId).toBe(USER_A);
    expect(result.awards).toEqual([{ userId: USER_A, amount: 100 }]);
  });

  it('lower hand loses', () => {
    const board: Card[] = ['Ah', 'Ad', '2c', '7s', '3h'];
    const result = resolveShowdown(
      ['Kh', 'Qd'] as Card[], // A has pair of aces (board) + KQ kicker
      ['Kd', 'Ks'] as Card[], // B has two pair: AA + KK
      board,
      200,
      USER_A, USER_B, BB_USER,
    );
    expect(result.winnerUserId).toBe(USER_B);
    expect(result.awards).toEqual([{ userId: USER_B, amount: 200 }]);
  });

  it('§17: chopped pot — each gets half', () => {
    // Both players have the same straight from the board
    const board: Card[] = ['Th', 'Jd', 'Qc', 'Ks', 'Ah'];
    const result = resolveShowdown(
      ['2h', '3d'] as Card[],
      ['4c', '5s'] as Card[],
      board,
      100,
      USER_A, USER_B, BB_USER,
    );
    expect(result.winnerUserId).toBeNull();
    expect(result.awards).toHaveLength(2);
    // Each gets 50
    const aAward = result.awards.find(a => a.userId === USER_A)!;
    const bAward = result.awards.find(a => a.userId === USER_B)!;
    expect(aAward.amount + bAward.amount).toBe(100);
    expect(aAward.amount).toBe(50);
    expect(bAward.amount).toBe(50);
  });

  it('§17: odd chip in chopped pot goes to OOP player (BB)', () => {
    const board: Card[] = ['Th', 'Jd', 'Qc', 'Ks', 'Ah'];
    const result = resolveShowdown(
      ['2h', '3d'] as Card[],
      ['4c', '5s'] as Card[],
      board,
      101, // Odd pot
      USER_A, USER_B, BB_USER,
    );
    expect(result.winnerUserId).toBeNull();
    // BB (OOP = USER_B) gets the extra chip
    const bAward = result.awards.find(a => a.userId === USER_B)!;
    const aAward = result.awards.find(a => a.userId === USER_A)!;
    expect(bAward.amount).toBe(51);
    expect(aAward.amount).toBe(50);
  });

  it('provides hand rank descriptions', () => {
    const board: Card[] = ['Ah', 'Kd', 'Qc', '2s', '7h'];
    const result = resolveShowdown(
      ['Ac', 'Ks'] as Card[], // Two pair
      ['3h', '4d'] as Card[], // Just a pair of aces from the board
      board,
      100,
      USER_A, USER_B, BB_USER,
    );
    expect(result.handRankA.name).toContain('Two Pair');
    expect(result.winnerUserId).toBe(USER_A);
  });
});

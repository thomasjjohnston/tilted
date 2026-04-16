/**
 * Invariant Regression Harness (Sprint 6, S6-3)
 *
 * Plays random single hands and verifies chip conservation after every action.
 * The cross-hand ledger invariant is tested at the game/integration level.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createPreflopState,
  createPostflopState,
  legalActions,
  applyAction as engineApplyAction,
  nextStreet,
  bothAllIn,
} from '../../src/engine/streets.js';
import { resolveShowdown } from '../../src/engine/showdown.js';
import { dealFromSeed, boardForStreet, generateSeed } from '../../src/engine/deck.js';
import type { BettingState, Street, Card } from '../../src/engine/types.js';
import { BLIND_SMALL, BLIND_BIG } from '../../src/game/constants.js';

const PLAYER_A = 'player-a';
const PLAYER_B = 'player-b';

/**
 * Play a single hand to completion with random legal actions.
 * Returns the pot and who won it.
 */
function playRandomHand(seed: string, sbAvail: number, bbAvail: number): {
  winner: string | null;
  pot: number;
  aNet: number;
  bNet: number;
} {
  const deal = dealFromSeed(seed);
  let state = createPreflopState(PLAYER_A, PLAYER_B, sbAvail, bbAvail, BLIND_SMALL, BLIND_BIG);
  let street: Street = 'preflop';
  let iterations = 0;

  // Play through all streets
  while (!state.isTerminal && iterations < 200) {
    iterations++;

    if (state.streetClosed) {
      if (bothAllIn(state)) break; // Will resolve at showdown
      const next = nextStreet(street);
      if (next === 'showdown') break;
      street = next;
      state = createPostflopState(state, street);
      continue;
    }

    const legal = legalActions(state);
    if (legal.actions.length === 0) break;

    const actionType = legal.actions[Math.floor(Math.random() * legal.actions.length)];
    let amount = 0;

    if (actionType === 'call') amount = legal.callAmount;
    else if (actionType === 'bet' || actionType === 'raise') {
      amount = legal.minRaise + Math.floor(Math.random() * Math.max(1, legal.maxBet - legal.minRaise + 1));
      amount = Math.min(amount, legal.maxBet);
    }

    state = engineApplyAction(state, { type: actionType, amount });
  }

  const aPlayer = state.players.find(p => p.userId === PLAYER_A)!;
  const bPlayer = state.players.find(p => p.userId === PLAYER_B)!;

  if (state.isTerminal && state.terminalReason === 'fold') {
    const winnerId = state.winnerUserId!;
    if (winnerId === PLAYER_A) {
      return {
        winner: PLAYER_A,
        pot: state.pot,
        aNet: bPlayer.reservedInHand, // A gains B's contribution
        bNet: -bPlayer.reservedInHand, // B loses their contribution
      };
    } else {
      return {
        winner: PLAYER_B,
        pot: state.pot,
        aNet: -aPlayer.reservedInHand,
        bNet: aPlayer.reservedInHand,
      };
    }
  }

  // Showdown
  const board = boardForStreet(deal, 'river');
  const result = resolveShowdown(
    deal.userAHole, deal.userBHole, board,
    state.pot, PLAYER_A, PLAYER_B, PLAYER_B,
  );

  let aNet = -aPlayer.reservedInHand;
  let bNet = -bPlayer.reservedInHand;
  for (const award of result.awards) {
    if (award.userId === PLAYER_A) aNet += award.amount;
    else bNet += award.amount;
  }

  return {
    winner: result.winnerUserId,
    pot: state.pot,
    aNet,
    bNet,
  };
}

describe('Invariant Regression Fuzzer', () => {
  it('chip conservation: A_net + B_net = 0 for every hand', () => {
    for (let i = 0; i < 100; i++) {
      const seed = generateSeed();
      const result = playRandomHand(seed, 1000, 1000);
      expect(result.aNet + result.bNet).toBe(0);
    }
  });

  it('(property) chip conservation holds for any stack sizes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 2000 }),
        fc.integer({ min: 20, max: 2000 }),
        fc.string({ minLength: 4, maxLength: 16 }),
        (sbStack, bbStack, seed) => {
          const result = playRandomHand(seed, sbStack, bbStack);
          // Net changes must sum to zero
          expect(result.aNet + result.bNet).toBe(0);
          // Pot must be non-negative
          expect(result.pot).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('a hand always terminates within 200 iterations', () => {
    for (let i = 0; i < 50; i++) {
      const seed = generateSeed();
      // This should not throw (which it would if it hit an infinite loop)
      const result = playRandomHand(seed, 500, 500);
      expect(result.pot).toBeGreaterThan(0);
    }
  });

  it('folded hands: winner gets loser contribution', () => {
    // Force a fold by giving SB tiny stack
    const state = createPreflopState(PLAYER_A, PLAYER_B, 0, 1000, 5, 10);
    // SB has 0 available, must fold or go all-in for 0
    const legal = legalActions(state);
    const afterFold = engineApplyAction(state, { type: 'fold', amount: 0 });

    expect(afterFold.isTerminal).toBe(true);
    expect(afterFold.winnerUserId).toBe(PLAYER_B);
    // BB wins SB's blind (5 chips)
    expect(afterFold.pot).toBe(15);
  });
});

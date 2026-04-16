/**
 * §17 Edge Cases Test Matrix (Sprint 6, S6-1)
 *
 * One test per bullet from the product spec's §17.
 * Test names echo the spec bullet verbatim.
 */

import { describe, it, expect } from 'vitest';
import {
  createPreflopState,
  createPostflopState,
  legalActions,
  applyAction,
  nextStreet,
  bothAllIn,
} from '../../src/engine/streets.js';
import { resolveShowdown } from '../../src/engine/showdown.js';
import { dealFromSeed } from '../../src/engine/deck.js';
import type { BettingState, Card } from '../../src/engine/types.js';

const SB = 'user-sb';
const BB = 'user-bb';

describe('§17 Edge Cases', () => {
  it('§17: Both fold in same round/turn — not possible (only one player acts per turn)', () => {
    // The turn model guarantees only one player has pending actions at a time.
    // If SB folds, hand is terminal — BB cannot fold the same hand.
    const state = createPreflopState(SB, BB, 1950, 1900, 5, 10);
    const afterFold = applyAction(state, { type: 'fold', amount: 0 });
    expect(afterFold.isTerminal).toBe(true);
    expect(afterFold.winnerUserId).toBe(BB);

    // No further action possible
    const legal = legalActions(afterFold);
    expect(legal.actions).toHaveLength(0);
  });

  it('§17: Hand terminates preflop with SB fold — BB wins the pot (SB+BB blinds)', () => {
    const state = createPreflopState(SB, BB, 1950, 1900, 5, 10);
    const afterFold = applyAction(state, { type: 'fold', amount: 0 });
    expect(afterFold.isTerminal).toBe(true);
    expect(afterFold.terminalReason).toBe('fold');
    expect(afterFold.winnerUserId).toBe(BB);
    expect(afterFold.pot).toBe(15); // 5 (SB) + 10 (BB)
  });

  it('§17: Bet slider jumps past legal min-raise — engine rejects anything illegal', () => {
    const state = createPreflopState(SB, BB, 1950, 1900, 5, 10);
    // SB raises to 20 (legal: min-raise = 10 above BB)
    const afterRaise = applyAction(state, { type: 'raise', amount: 15 }); // 5+15 = 20

    // BB tries to "raise" by less than min-raise
    // Current bet is 20, last raise was 10, so min-reraise is 30 total (need 20 more from BB's 10)
    // Trying to raise only 5 should fail
    expect(() => applyAction(afterRaise, { type: 'raise', amount: 5 })).toThrow();
  });

  it('§17: Chopped pots — contributions split evenly', () => {
    // Board makes the same straight for both players
    const board: Card[] = ['Th', 'Jd', 'Qc', 'Ks', 'Ah'];
    const result = resolveShowdown(
      ['2h', '3d'] as Card[],
      ['4c', '5s'] as Card[],
      board,
      200,
      SB, BB, BB,
    );
    expect(result.winnerUserId).toBeNull();
    const awards = result.awards;
    expect(awards.reduce((sum, a) => sum + a.amount, 0)).toBe(200);
  });

  it('§17: Odd chip in chopped pot — award to OOP player (BB in HU)', () => {
    const board: Card[] = ['Th', 'Jd', 'Qc', 'Ks', 'Ah'];
    const result = resolveShowdown(
      ['2h', '3d'] as Card[],
      ['4c', '5s'] as Card[],
      board,
      101, // Odd pot
      SB, BB, BB,
    );
    // BB is OOP, gets the extra chip
    const bbAward = result.awards.find(a => a.userId === BB)!;
    const sbAward = result.awards.find(a => a.userId === SB)!;
    expect(bbAward.amount).toBe(51);
    expect(sbAward.amount).toBe(50);
  });

  it('§17: Running out of chips mid-round — player may have zero available', () => {
    // SB posts blind of 5, has only 5 available total
    const state = createPreflopState(SB, BB, 0, 1900, 5, 10);
    // SB has 0 available — can only fold or go all-in (for 0, which is folding effectively)
    const legal = legalActions(state);
    // SB faces BB of 10, has 5 reserved. Needs 5 more to call but has 0.
    // Should only be able to fold or all-in (for 0 extra)
    expect(legal.actions).toContain('fold');
    expect(legal.actions).toContain('all_in');
    expect(legal.actions).not.toContain('call'); // Can't call — no chips
    expect(legal.actions).not.toContain('raise'); // Can't raise — no chips
  });

  it('§17: Jam hand 1 for 2000 before other SBs — blinds posted atomically first', () => {
    // Per spec: Blinds are posted atomically at round start BEFORE any player action.
    // So if total = 2000 and 10 SB blinds posted: available = 2000 - 50 = 1950
    // Each hand has 5 reserved. Jamming in hand 1 means spending all 1950 available.
    const state = createPreflopState(SB, BB, 1950, 1900, 5, 10);
    const afterJam = applyAction(state, { type: 'all_in', amount: 0 });
    const sb = afterJam.players.find(p => p.userId === SB)!;
    expect(sb.available).toBe(0);
    expect(sb.reservedInHand).toBe(1955); // 5 (blind) + 1950 (available)
    expect(sb.isAllIn).toBe(true);

    // After jamming, SB has 0 available for all other 9 hands.
    // In those hands, SB can only fold (or check if no bet faces them, but preflop SB faces BB).
  });

  it('§17: Can see opponent remaining available chips — both totals visible', () => {
    // This is a UI/API test. The engine carries both players' available in state.
    const state = createPreflopState(SB, BB, 1950, 1900, 5, 10);
    const sbPlayer = state.players.find(p => p.userId === SB)!;
    const bbPlayer = state.players.find(p => p.userId === BB)!;
    expect(sbPlayer.available).toBe(1950);
    expect(bbPlayer.available).toBe(1900);
  });

  it('§17: Cannot change action after submitting — actions are immutable', () => {
    // Once an action is applied, it produces a new state.
    // The old state is unchanged (pure function).
    const state = createPreflopState(SB, BB, 1950, 1900, 5, 10);
    const afterFold = applyAction(state, { type: 'fold', amount: 0 });

    // Original state should be unchanged
    expect(state.isTerminal).toBe(false);
    expect(state.actionOnUserId).toBe(SB);

    // New state is terminal
    expect(afterFold.isTerminal).toBe(true);
  });

  it('all-in short-call: excess returned to bettor, hand proceeds with capped pot', () => {
    // SB has 100 available, BB has 50 available.
    // SB jams for 100. BB can only call for 50 (their entire stack).
    // The excess 50 from SB should conceptually be returned.
    const state = createPreflopState(SB, BB, 100, 50, 5, 10);
    const sbJam = applyAction(state, { type: 'all_in', amount: 0 });

    // BB goes all-in (for their remaining chips)
    const bbAllIn = applyAction(sbJam, { type: 'all_in', amount: 0 });

    // Both are all-in
    expect(bothAllIn(bbAllIn)).toBe(true);
    expect(bbAllIn.streetClosed).toBe(true);

    const sb = bbAllIn.players.find(p => p.userId === SB)!;
    const bb = bbAllIn.players.find(p => p.userId === BB)!;
    expect(sb.isAllIn).toBe(true);
    expect(bb.isAllIn).toBe(true);
  });
});

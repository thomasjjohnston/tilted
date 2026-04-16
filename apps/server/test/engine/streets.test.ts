import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createPreflopState,
  createPostflopState,
  legalActions,
  applyAction,
  nextStreet,
  bothAllIn,
} from '../../src/engine/streets.js';
import type { BettingState, ActionType } from '../../src/engine/types.js';

const SB = 'sb-user';
const BB = 'bb-user';

function preflopState(sbAvail = 1950, bbAvail = 1900): BettingState {
  return createPreflopState(SB, BB, sbAvail, bbAvail, 5, 10);
}

describe('streets', () => {
  describe('createPreflopState', () => {
    it('creates correct initial state', () => {
      const state = preflopState();
      expect(state.street).toBe('preflop');
      expect(state.pot).toBe(15); // 5 + 10
      expect(state.currentBet).toBe(10); // BB level
      expect(state.actionOnUserId).toBe(SB); // SB acts first preflop
      expect(state.players[0].reservedInHand).toBe(5); // SB blind
      expect(state.players[1].reservedInHand).toBe(10); // BB blind
    });
  });

  describe('legalActions', () => {
    it('SB preflop can fold, call, raise, or all-in', () => {
      const state = preflopState();
      const legal = legalActions(state);
      expect(legal.actions).toContain('fold');
      expect(legal.actions).toContain('call');
      expect(legal.actions).toContain('raise');
      expect(legal.actions).toContain('all_in');
    });

    it('SB preflop call amount is 5 (to match BB of 10)', () => {
      const state = preflopState();
      const legal = legalActions(state);
      expect(legal.callAmount).toBe(5); // 10 - 5 (already posted SB)
    });

    it('BB after SB limp can check, bet, or all-in', () => {
      const state = preflopState();
      const afterLimp = applyAction(state, { type: 'call', amount: 5 });
      const legal = legalActions(afterLimp);
      expect(legal.actions).toContain('check');
      expect(legal.actions).toContain('bet');
      expect(legal.actions).toContain('all_in');
      expect(legal.actions).not.toContain('fold');
    });

    it('returns empty actions when hand is terminal', () => {
      const state = preflopState();
      const afterFold = applyAction(state, { type: 'fold', amount: 0 });
      const legal = legalActions(afterFold);
      expect(legal.actions).toHaveLength(0);
    });

    it('returns empty actions when street is closed', () => {
      const state = preflopState();
      const afterCall = applyAction(state, { type: 'call', amount: 5 });
      // BB checks to close the street — but first BB should check
      // After SB limps, it's BB's turn
      expect(afterCall.actionOnUserId).toBe(BB);
      const afterCheck = applyAction(afterCall, { type: 'check', amount: 0 });
      expect(afterCheck.streetClosed).toBe(true);
      const legal = legalActions(afterCheck);
      expect(legal.actions).toHaveLength(0);
    });
  });

  describe('applyAction', () => {
    describe('fold', () => {
      it('makes hand terminal with opponent as winner', () => {
        const state = preflopState();
        const result = applyAction(state, { type: 'fold', amount: 0 });
        expect(result.isTerminal).toBe(true);
        expect(result.terminalReason).toBe('fold');
        expect(result.winnerUserId).toBe(BB);
      });

      it('§17: SB fold preflop — BB wins the pot (15 chips: 5 SB + 10 BB)', () => {
        const state = preflopState();
        const result = applyAction(state, { type: 'fold', amount: 0 });
        expect(result.pot).toBe(15);
        expect(result.winnerUserId).toBe(BB);
      });
    });

    describe('call', () => {
      it('SB calls preflop (limp): moves 5 chips to match BB', () => {
        const state = preflopState();
        const result = applyAction(state, { type: 'call', amount: 5 });
        const sb = result.players.find(p => p.userId === SB)!;
        expect(sb.reservedInHand).toBe(10); // 5 + 5
        expect(sb.available).toBe(1945);    // 1950 - 5
        expect(result.pot).toBe(20);        // 10 + 10
      });
    });

    describe('bet', () => {
      it('postflop bet: updates pot and current bet', () => {
        // Create a postflop state
        const preflop = preflopState();
        const afterCall = applyAction(preflop, { type: 'call', amount: 5 });
        const afterCheck = applyAction(afterCall, { type: 'check', amount: 0 });
        // Now create flop state
        const flopState = createPostflopState(afterCheck, 'flop');
        expect(flopState.actionOnUserId).toBe(BB); // BB acts first postflop

        const afterBet = applyAction(flopState, { type: 'bet', amount: 20 });
        expect(afterBet.pot).toBe(40); // 20 in pot + 20 bet
        expect(afterBet.currentBet).toBe(30); // 10 (reserved from preflop) + 20
        expect(afterBet.actionOnUserId).toBe(SB); // Action passes to SB
      });
    });

    describe('raise', () => {
      it('SB raises preflop: min raise is 10 (matching the BB raise size)', () => {
        const state = preflopState();
        // SB raises to 20 total (10 more than BB, which is the min raise)
        const result = applyAction(state, { type: 'raise', amount: 15 }); // 5 (posted) + 15 = 20 total
        expect(result.pot).toBe(30); // 15 + 15
        expect(result.currentBet).toBe(20); // SB now at 20
        expect(result.actionOnUserId).toBe(BB);
      });

      it('3-bet: BB re-raises', () => {
        const state = preflopState();
        const sbRaise = applyAction(state, { type: 'raise', amount: 15 }); // SB to 20
        // BB can now 3-bet. Min raise = previous raise was 10 (20-10), so min 3-bet is 30
        const bb3bet = applyAction(sbRaise, { type: 'raise', amount: 20 }); // BB: 10 + 20 = 30 total
        expect(bb3bet.pot).toBe(50);
        expect(bb3bet.currentBet).toBe(30);
        expect(bb3bet.actionOnUserId).toBe(SB);
      });
    });

    describe('all_in', () => {
      it('SB jams preflop for entire stack', () => {
        const state = preflopState(1950, 1900);
        const result = applyAction(state, { type: 'all_in', amount: 0 });
        const sb = result.players.find(p => p.userId === SB)!;
        expect(sb.available).toBe(0);
        expect(sb.reservedInHand).toBe(1955); // 5 (blind) + 1950 (available)
        expect(sb.isAllIn).toBe(true);
      });

      it('§17: Jam hand 1 for 2000 — must post all blinds first', () => {
        // Spec says blinds are posted atomically before any action
        // So if total = 2000 and 10 SBs are posted, available = 1950
        // Jamming in one hand means available goes to 0 after committing 1950
        const state = preflopState(1950); // Available after blinds
        const result = applyAction(state, { type: 'all_in', amount: 0 });
        const sb = result.players.find(p => p.userId === SB)!;
        expect(sb.available).toBe(0);
        expect(sb.isAllIn).toBe(true);
      });

      it('both all-in: street closes', () => {
        const state = preflopState(100, 100);
        const sbJam = applyAction(state, { type: 'all_in', amount: 0 });
        const bbCall = applyAction(sbJam, { type: 'all_in', amount: 0 });
        expect(bbCall.streetClosed).toBe(true);
        expect(bothAllIn(bbCall)).toBe(true);
      });

      it('short-stack all-in for less: street closes', () => {
        // SB has only 3 chips available, facing a BB of 10
        const state = createPreflopState(SB, BB, 3, 1900, 5, 10);
        // SB can only go all-in for their remaining 3
        const result = applyAction(state, { type: 'all_in', amount: 0 });
        const sb = result.players.find(p => p.userId === SB)!;
        expect(sb.available).toBe(0);
        expect(sb.reservedInHand).toBe(8); // 5 + 3
        expect(result.streetClosed).toBe(true); // SB is all-in for less
      });
    });

    describe('street closing', () => {
      it('preflop: SB calls, BB checks → street closed', () => {
        const state = preflopState();
        const afterCall = applyAction(state, { type: 'call', amount: 5 });
        expect(afterCall.streetClosed).toBe(false);
        expect(afterCall.actionOnUserId).toBe(BB);

        const afterCheck = applyAction(afterCall, { type: 'check', amount: 0 });
        expect(afterCheck.streetClosed).toBe(true);
      });

      it('postflop: both check → street closed', () => {
        const state = preflopState();
        const afterCall = applyAction(state, { type: 'call', amount: 5 });
        const afterCheck = applyAction(afterCall, { type: 'check', amount: 0 });
        const flop = createPostflopState(afterCheck, 'flop');

        const bbCheck = applyAction(flop, { type: 'check', amount: 0 });
        const sbCheck = applyAction(bbCheck, { type: 'check', amount: 0 });
        expect(sbCheck.streetClosed).toBe(true);
      });

      it('bet-call closes the street', () => {
        const state = preflopState();
        const afterCall = applyAction(state, { type: 'call', amount: 5 });
        const afterCheck = applyAction(afterCall, { type: 'check', amount: 0 });
        const flop = createPostflopState(afterCheck, 'flop');

        const afterBet = applyAction(flop, { type: 'bet', amount: 20 });
        const afterCallBet = applyAction(afterBet, { type: 'call', amount: 20 });
        expect(afterCallBet.streetClosed).toBe(true);
      });
    });

    describe('illegal actions', () => {
      it('throws on fold when no bet faces you', () => {
        const state = preflopState();
        const afterCall = applyAction(state, { type: 'call', amount: 5 });
        // BB has no bet facing them (just the blind they posted)
        expect(() => applyAction(afterCall, { type: 'fold', amount: 0 })).toThrow('Illegal action');
      });

      it('throws on action when hand is terminal', () => {
        const state = preflopState();
        const afterFold = applyAction(state, { type: 'fold', amount: 0 });
        expect(() => applyAction(afterFold, { type: 'check', amount: 0 })).toThrow('terminal');
      });
    });
  });

  describe('nextStreet', () => {
    it('preflop → flop', () => expect(nextStreet('preflop')).toBe('flop'));
    it('flop → turn', () => expect(nextStreet('flop')).toBe('turn'));
    it('turn → river', () => expect(nextStreet('turn')).toBe('river'));
    it('river → showdown', () => expect(nextStreet('river')).toBe('showdown'));
  });

  describe('property: random legal play always terminates', () => {
    it('a hand played with random legal actions always reaches terminal or street-closed', () => {
      fc.assert(
        fc.property(fc.integer({ min: 100, max: 2000 }), fc.integer({ min: 100, max: 2000 }), (sbStack, bbStack) => {
          let state = createPreflopState(SB, BB, sbStack, bbStack, 5, 10);
          let iterations = 0;

          while (!state.isTerminal && !state.streetClosed && iterations < 100) {
            const legal = legalActions(state);
            if (legal.actions.length === 0) break;

            // Pick a random legal action
            const actionType = legal.actions[Math.floor(Math.random() * legal.actions.length)];
            let amount = 0;

            if (actionType === 'call') amount = legal.callAmount;
            else if (actionType === 'bet' || actionType === 'raise') {
              amount = legal.minRaise + Math.floor(Math.random() * (legal.maxBet - legal.minRaise + 1));
            }

            state = applyAction(state, { type: actionType, amount });
            iterations++;
          }

          // Must have terminated or closed within 100 iterations
          expect(state.isTerminal || state.streetClosed || legalActions(state).actions.length === 0).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});

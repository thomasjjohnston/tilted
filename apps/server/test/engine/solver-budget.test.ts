import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  fitTurnToStack, passiveTurn, type BudgetInput, type BudgetedAction,
} from '../../src/engine/solver/budget.js';

const d = (handId: string, actionType: BudgetInput['actionType'], toCall: number, amount = 0): BudgetInput =>
  ({ handId, actionType, amount, toCall });

/** Replay a turn the way the server charges it; throws on an illegal action. */
function spend(actions: BudgetedAction[], inputs: BudgetInput[], available: number): number {
  const toCall = new Map(inputs.map(i => [i.handId, i.toCall]));
  let remaining = available;
  for (const a of actions) {
    const t = toCall.get(a.handId)!;
    switch (a.actionType) {
      case 'fold': break;
      case 'check':
        if (t !== 0) throw new Error(`check facing a bet in ${a.handId}`);
        break;
      case 'call':
        if (t === 0) throw new Error(`call with nothing to call in ${a.handId}`);
        if (t >= remaining) throw new Error(`call of ${t} with ${remaining} left in ${a.handId}`);
        remaining -= t;
        break;
      case 'bet':
      case 'raise':
        if (a.amount <= 0 || a.amount >= remaining) throw new Error(`raise ${a.amount} with ${remaining} left`);
        remaining -= a.amount;
        break;
      case 'all_in':
        if (remaining <= 0) throw new Error(`all-in with nothing left in ${a.handId}`);
        remaining = 0;
        break;
    }
  }
  return remaining;
}

describe('fitTurnToStack', () => {
  it('leaves an affordable turn untouched', () => {
    const inputs = [d('a', 'call', 5), d('b', 'raise', 5, 20), d('c', 'fold', 5), d('d', 'check', 0)];
    const out = fitTurnToStack(inputs, 1950);
    expect(out.map(a => [a.handId, a.actionType, a.amount, a.adjusted])).toEqual([
      ['a', 'call', 0, false], ['b', 'raise', 20, false], ['c', 'fold', 0, false], ['d', 'check', 0, false],
    ]);
  });

  it('ten all-ins become one all-in, placed last, and nine folds', () => {
    const inputs = Array.from({ length: 10 }, (_, i) => d(`h${i}`, 'all_in', 5));
    const out = fitTurnToStack(inputs, 1950);
    expect(out.filter(a => a.actionType === 'all_in')).toHaveLength(1);
    expect(out.filter(a => a.actionType === 'fold')).toHaveLength(9);
    expect(spend(out, inputs, 1950)).toBe(0);
  });

  it('an all-in is submitted after the hands that keep chips behind', () => {
    const inputs = [d('shove', 'all_in', 5), d('call', 'call', 5), d('raise', 'raise', 5, 20)];
    const out = fitTurnToStack(inputs, 1950);
    expect(out.map(a => a.handId)).toEqual(['call', 'raise', 'shove']);
    expect(out.map(a => a.actionType)).toEqual(['call', 'raise', 'all_in']);
    expect(out.every(a => !a.adjusted)).toBe(true);
  });

  it('a raise that no longer fits becomes a call, not a shove', () => {
    const inputs = [d('a', 'raise', 10, 900), d('b', 'raise', 10, 900), d('c', 'raise', 10, 900)];
    const out = fitTurnToStack(inputs, 1000);
    expect(out.map(a => a.actionType)).toEqual(['raise', 'call', 'call']);
    expect(out.map(a => a.adjusted)).toEqual([false, true, true]);
    expect(spend(out, inputs, 1000)).toBe(80);
  });

  it('with nothing left, a free hand checks and a bet hand folds', () => {
    const out = fitTurnToStack([d('free', 'bet', 0, 50), d('facing', 'call', 30)], 0);
    expect(out.map(a => [a.handId, a.actionType])).toEqual([['free', 'check'], ['facing', 'fold']]);
  });

  it('a call that would take the whole stack is an all-in', () => {
    const inputs = [d('a', 'call', 500)];
    expect(fitTurnToStack(inputs, 500).map(a => a.actionType)).toEqual(['all_in']);
    expect(fitTurnToStack(inputs, 300).map(a => a.actionType)).toEqual(['all_in']);
  });

  it('returns exactly one action per hand', () => {
    const inputs = [d('a', 'all_in', 5), d('b', 'call', 5), d('c', 'all_in', 0), d('d', 'raise', 5, 99999)];
    const out = fitTurnToStack(inputs, 100);
    expect(out.map(a => a.handId).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('property: any mix of wishes yields a turn the stack can pay for', () => {
    const decision = fc.record({
      actionType: fc.constantFrom<BudgetInput['actionType']>('fold', 'check', 'call', 'bet', 'raise', 'all_in'),
      toCall: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 3000 })),
      amount: fc.integer({ min: 0, max: 4000 }),
    });
    fc.assert(fc.property(
      fc.array(decision, { minLength: 1, maxLength: 10 }),
      fc.integer({ min: 0, max: 4000 }),
      (raw, available) => {
        const inputs = raw.map((r, i) => {
          // A wish must be self-consistent before budgeting: no check facing
          // a bet, no call facing nothing (the decision layer guarantees it).
          let actionType = r.actionType;
          if (actionType === 'check' && r.toCall > 0) actionType = 'call';
          if (actionType === 'call' && r.toCall === 0) actionType = 'check';
          return { handId: `h${i}`, actionType, amount: r.amount, toCall: r.toCall };
        });
        const out = fitTurnToStack(inputs, available);
        expect(out).toHaveLength(inputs.length);
        expect(new Set(out.map(a => a.handId)).size).toBe(inputs.length);
        expect(spend(out, inputs, available)).toBeGreaterThanOrEqual(0);
        expect(out.filter(a => a.actionType === 'all_in').length).toBeLessThanOrEqual(1);
      },
    ));
  });
});

describe('passiveTurn', () => {
  it('checks when free, calls while it fits, folds otherwise', () => {
    const inputs = [d('a', 'all_in', 0), d('b', 'raise', 40, 500), d('c', 'call', 80), d('d', 'call', 10)];
    const out = passiveTurn(inputs, 100);
    expect(out.map(a => a.actionType)).toEqual(['check', 'call', 'fold', 'call']);
    expect(spend(out, inputs, 100)).toBe(50);
  });

  it('property: always affordable and never commits the whole stack', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 3000 }), { minLength: 1, maxLength: 10 }),
      fc.integer({ min: 0, max: 4000 }),
      (calls, available) => {
        const inputs = calls.map((t, i) => d(`h${i}`, 'all_in', t));
        const out = passiveTurn(inputs, available);
        expect(out.some(a => a.actionType === 'all_in')).toBe(false);
        const left = spend(out, inputs, available);
        expect(left).toBeGreaterThanOrEqual(0);
      },
    ));
  });
});

import { describe, it, expect } from 'vitest';
import { generateActionSketch } from '../../src/game/action-sketch.js';

const SB = 'user-sb';
const BB = 'user-bb';

describe('action sketch generator', () => {
  it('preflop fold', () => {
    const sketch = generateActionSketch(
      [{ street: 'preflop', actingUserId: SB, actionType: 'fold', amount: 0 }],
      BB, 15, SB, BB,
    );
    expect(sketch).toBe('SB folded — BB wins 15');
  });

  it('preflop raise + call, flop bet + call', () => {
    const sketch = generateActionSketch(
      [
        { street: 'preflop', actingUserId: SB, actionType: 'raise', amount: 20 },
        { street: 'preflop', actingUserId: BB, actionType: 'call', amount: 10 },
        { street: 'flop', actingUserId: BB, actionType: 'bet', amount: 30 },
        { street: 'flop', actingUserId: SB, actionType: 'call', amount: 30 },
      ],
      SB, 100, SB, BB,
    );
    expect(sketch).toBe('SB raised to 20, BB called 10; BB bet 30, SB called 30 — SB wins 100');
  });

  it('checked to river', () => {
    const sketch = generateActionSketch(
      [
        { street: 'preflop', actingUserId: SB, actionType: 'call', amount: 5 },
        { street: 'preflop', actingUserId: BB, actionType: 'check', amount: 0 },
        { street: 'flop', actingUserId: BB, actionType: 'check', amount: 0 },
        { street: 'flop', actingUserId: SB, actionType: 'check', amount: 0 },
        { street: 'turn', actingUserId: BB, actionType: 'check', amount: 0 },
        { street: 'turn', actingUserId: SB, actionType: 'check', amount: 0 },
        { street: 'river', actingUserId: BB, actionType: 'bet', amount: 10 },
        { street: 'river', actingUserId: SB, actionType: 'call', amount: 10 },
      ],
      BB, 40, SB, BB,
    );
    expect(sketch).toContain('flop checked');
    expect(sketch).toContain('turn checked');
    expect(sketch).toContain('BB wins 40');
  });

  it('split pot', () => {
    const sketch = generateActionSketch(
      [
        { street: 'preflop', actingUserId: SB, actionType: 'call', amount: 5 },
        { street: 'preflop', actingUserId: BB, actionType: 'check', amount: 0 },
      ],
      null, 20, SB, BB,
    );
    expect(sketch).toContain('split pot 20');
  });

  it('all-in jam', () => {
    const sketch = generateActionSketch(
      [
        { street: 'preflop', actingUserId: SB, actionType: 'all_in', amount: 0 },
        { street: 'preflop', actingUserId: BB, actionType: 'all_in', amount: 0 },
      ],
      SB, 4000, SB, BB,
    );
    expect(sketch).toBe('SB jammed, BB jammed — SB wins 4000');
  });
});

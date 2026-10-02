import { describe, it, expect } from 'vitest';
import {
  generateDisplayName, NAME_ADJECTIVES, NAME_NOUNS, NAME_FIXED,
} from '../../src/lib/player-names.js';

/** Deterministic stand-in for Math.random: replays the given values. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('generateDisplayName', () => {
  it('builds "Adjective Noun N" from the lists', () => {
    // 0.9 → not fixed; first adjective; first noun; number 1
    expect(generateDisplayName(seq([0.9, 0, 0, 0]))).toBe(`${NAME_ADJECTIVES[0]} ${NAME_NOUNS[0]} 1`);
  });

  it('builds "Fixed Nickname N" when the fixed branch is rolled', () => {
    expect(generateDisplayName(seq([0, 0, 0.999]))).toBe(`${NAME_FIXED[0]} 99`);
  });

  it('never indexes past the end of a list', () => {
    const name = generateDisplayName(seq([0.999999]));
    expect(name).toBe(`${NAME_ADJECTIVES.at(-1)} ${NAME_NOUNS.at(-1)} 99`);
  });

  it('always yields a short, well-formed name', () => {
    for (let i = 0; i < 500; i++) {
      const name = generateDisplayName();
      expect(name).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+){1,2} [1-9]\d?$/);
      expect(name.length).toBeLessThanOrEqual(24);
    }
  });
});

import { ALL_CARDS, type Card } from './types.js';

/**
 * xoroshiro128** PRNG — deterministic, fast, well-distributed.
 * Seeded from a string via a simple hash.
 */
class Xoroshiro128 {
  private s0: bigint;
  private s1: bigint;

  constructor(seed: string) {
    // Hash seed string to two 64-bit values using splitmix64
    let h = 0n;
    for (let i = 0; i < seed.length; i++) {
      h = BigInt(seed.charCodeAt(i)) + (h << 6n) + (h << 16n) - h;
      h = BigInt.asUintN(64, h);
    }
    this.s0 = this.splitmix64(h);
    this.s1 = this.splitmix64(this.s0 + 0x9e3779b97f4a7c15n);
  }

  private splitmix64(x: bigint): bigint {
    x = BigInt.asUintN(64, x);
    x = BigInt.asUintN(64, (x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n);
    x = BigInt.asUintN(64, (x ^ (x >> 27n)) * 0x94d049bb133111ebn);
    return BigInt.asUintN(64, x ^ (x >> 31n));
  }

  private rotl(x: bigint, k: bigint): bigint {
    return BigInt.asUintN(64, (x << k) | (x >> (64n - k)));
  }

  next(): bigint {
    const s0 = this.s0;
    let s1 = this.s1;
    // xoroshiro128** result calculation
    const result = BigInt.asUintN(64, this.rotl(BigInt.asUintN(64, s0 * 5n), 7n) * 9n);

    s1 ^= s0;
    this.s0 = BigInt.asUintN(64, this.rotl(s0, 24n) ^ s1 ^ (s1 << 16n));
    this.s1 = this.rotl(s1, 37n);

    return result;
  }

  /** Returns a float in [0, 1) */
  nextFloat(): number {
    return Number(this.next() >> 11n) / (2 ** 53);
  }
}

/**
 * Produces a deterministic shuffled deck from a seed string.
 * Same seed always yields the same order.
 */
export function shuffleDeck(seed: string): Card[] {
  const rng = new Xoroshiro128(seed);
  const deck = [...ALL_CARDS];

  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

/**
 * Deal from a seeded deck. Returns hole cards and board in order.
 * Deck layout for HU Hold'em:
 *   [0..1] = Player A hole cards
 *   [2..3] = Player B hole cards
 *   [4] = burn, [5..7] = flop
 *   [8] = burn, [9] = turn
 *   [10] = burn, [11] = river
 */
export interface Deal {
  userAHole: [Card, Card];
  userBHole: [Card, Card];
  flop: [Card, Card, Card];
  turn: Card;
  river: Card;
}

export function dealFromSeed(seed: string): Deal {
  const deck = shuffleDeck(seed);
  return {
    userAHole: [deck[0], deck[1]],
    userBHole: [deck[2], deck[3]],
    flop: [deck[5], deck[6], deck[7]],  // deck[4] is burn
    turn: deck[9],                       // deck[8] is burn
    river: deck[11],                     // deck[10] is burn
  };
}

/** Get board cards for a given street from a deal. */
export function boardForStreet(deal: Deal, street: 'preflop' | 'flop' | 'turn' | 'river'): Card[] {
  switch (street) {
    case 'preflop': return [];
    case 'flop': return [...deal.flop];
    case 'turn': return [...deal.flop, deal.turn];
    case 'river': return [...deal.flop, deal.turn, deal.river];
  }
}

/** Generate a random seed string. */
export function generateSeed(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let seed = '';
  for (let i = 0; i < 16; i++) {
    seed += chars[Math.floor(Math.random() * chars.length)];
  }
  return seed;
}

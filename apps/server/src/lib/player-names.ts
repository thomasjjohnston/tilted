// Generated display names for players who sign in with Apple's "hide my
// name" option, so they show up as "River Rat 42" instead of "User" or a
// private-relay email prefix. Edit the lists freely; any adjective pairs
// with any noun.

export const NAME_ADJECTIVES: readonly string[] = [
  'Lucky', 'Sneaky', 'Tilted', 'Reckless', 'Patient', 'Shifty', 'Fearless',
  'Sleepy', 'Wily', 'Salty', 'Cheeky', 'Stoic', 'Wild', 'Sly', 'Grizzled',
  'Jolly', 'Daring', 'Crafty', 'Mellow', 'Rowdy',
];

export const NAME_NOUNS: readonly string[] = [
  'Gutshot', 'Kicker', 'Dealer', 'Shark', 'Maverick', 'Bluffer', 'Grinder',
  'Limper', 'Raiser', 'Flusher', 'Cowboy', 'Rocket', 'Ducks', 'Button',
  'Nit', 'Whale', 'Railbird', 'Hustler', 'Gambler', 'Ace',
];

// "River Rat" style two-word nicknames that read better as a unit.
export const NAME_FIXED: readonly string[] = [
  'River Rat', 'Big Slick', 'Pocket Rocket', 'Card Shark', 'Calling Station',
  'Chip Leader', 'Dead Money', 'Short Stack', 'Cold Deck', 'Slow Roller',
  'Bad Beat', 'Top Pair', 'Wheel House', 'Fish Hook', 'Blind Thief',
];

/**
 * Pick a display name like "Lucky Gutshot 7" or "River Rat 42".
 * `random` is injectable so tests are deterministic. Names are not unique:
 * the trailing number just makes collisions between friends unlikely.
 */
export function generateDisplayName(random: () => number = Math.random): string {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const useFixed = random() < 0.3;
  const base = useFixed ? pick(NAME_FIXED) : `${pick(NAME_ADJECTIVES)} ${pick(NAME_NOUNS)}`;
  const number = 1 + Math.floor(random() * 99);
  return `${base} ${number}`;
}

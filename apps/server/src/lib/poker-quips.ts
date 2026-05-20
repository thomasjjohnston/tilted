// Randomized funny push-notification copy for the "ping opponent"
// feature. Mix of classic poker terms (snap call, time bank, donk,
// tank, slow roll, muck, range, hero call) and modern online slang
// (AFK, tilted, GTO, VPIP). Each ping picks one at random.

export const POKER_QUIPS: readonly string[] = [
  'Your time bank is melting.',
  'Tank harder, I dare you.',
  'AFK or just tilted?',
  'Snap call already, ya donk.',
  "Is this a hero call situation or…?",
  'Slow rolling me in turn-based poker is impressive.',
  'GTO says act now.',
  'Your VPIP this match: 0%.',
  "Don't muck on me now.",
  "Bluff catcher's getting cold.",
  "Hands won't fold themselves.",
  "Pot's getting stale.",
  "Time's up. Call clock.",
  'You sleeping on this nut hand?',
  'Big blind, bigger excuses.',
  'Your stack is begging for action.',
  'Even Phil Hellmuth acts faster.',
  'Donk bet incoming or what?',
  'I can hear the tilt from here.',
  'Floor! Call the floor!',
  'Open shove and end my suffering.',
  'Stop slow-playing your phone.',
  'Limp in already.',
  'Range check: do you have one?',
  'Min-raise me, I dare you.',
  "Cards aren't gonna play themselves.",
  'All-in pre is always an option.',
  'Your fold equity is showing.',
  'Hit-and-run? After zero hands?',
  "Action's on you, champ.",
];

export function randomQuip(): string {
  const idx = Math.floor(Math.random() * POKER_QUIPS.length);
  return POKER_QUIPS[idx];
}

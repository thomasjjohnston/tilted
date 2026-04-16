/**
 * Self-play CLI: runs a single hand with random legal actions.
 * No database needed — exercises the pure engine only.
 *
 * Usage: pnpm engine:self-play
 */

import { dealFromSeed, generateSeed, boardForStreet } from '../engine/deck.js';
import { createPreflopState, createPostflopState, legalActions, applyAction, nextStreet, bothAllIn } from '../engine/streets.js';
import { resolveShowdown } from '../engine/showdown.js';
import type { BettingState, Street, Card } from '../engine/types.js';

const SB = 'Player-A (SB)';
const BB = 'Player-B (BB)';

function playHand(seed: string) {
  const deal = dealFromSeed(seed);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Hand seed: ${seed}`);
  console.log(`${SB} hole: ${deal.userAHole.join(' ')}`);
  console.log(`${BB} hole: ${deal.userBHole.join(' ')}`);
  console.log(`${'='.repeat(60)}`);

  const sbStack = 1950; // After posting 10 SB blinds across the round
  const bbStack = 1900;

  let state: BettingState = createPreflopState(SB, BB, sbStack, bbStack, 5, 10);
  let currentStreet: Street = 'preflop';

  console.log(`\n--- PREFLOP --- (pot: ${state.pot})`);

  while (!state.isTerminal) {
    if (state.streetClosed) {
      // Advance street
      const next = nextStreet(currentStreet);
      if (next === 'showdown') break;

      if (bothAllIn(state)) {
        console.log(`\nBoth players all-in! Awaiting runout.`);
        break;
      }

      currentStreet = next;
      state = createPostflopState(state, currentStreet);

      const board = boardForStreet(deal, currentStreet);
      console.log(`\n--- ${currentStreet.toUpperCase()} --- Board: ${board.join(' ')} (pot: ${state.pot})`);
    }

    const legal = legalActions(state);
    if (legal.actions.length === 0) break;

    // Pick a random legal action
    const actionType = legal.actions[Math.floor(Math.random() * legal.actions.length)];
    let amount = 0;

    if (actionType === 'call') amount = legal.callAmount;
    else if (actionType === 'bet' || actionType === 'raise') {
      amount = legal.minRaise + Math.floor(Math.random() * Math.max(1, legal.maxBet - legal.minRaise + 1));
      amount = Math.min(amount, legal.maxBet);
    }

    const actor = state.actionOnUserId;
    console.log(`  ${actor}: ${actionType}${amount > 0 ? ` ${amount}` : ''}`);

    state = applyAction(state, { type: actionType, amount });
  }

  // Resolve
  if (state.isTerminal && state.terminalReason === 'fold') {
    console.log(`\n>>> ${state.winnerUserId} wins ${state.pot} (opponent folded)`);
  } else {
    // Showdown or all-in runout
    const board = boardForStreet(deal, 'river');
    console.log(`\n--- SHOWDOWN --- Board: ${board.join(' ')}`);

    const result = resolveShowdown(
      deal.userAHole, deal.userBHole, board,
      state.pot, SB, BB, BB,
    );

    console.log(`  ${SB}: ${result.handRankA.name}`);
    console.log(`  ${BB}: ${result.handRankB.name}`);

    if (result.winnerUserId) {
      console.log(`\n>>> ${result.winnerUserId} wins ${state.pot}`);
    } else {
      console.log(`\n>>> Split pot! Each gets ${Math.floor(state.pot / 2)}`);
    }
  }
}

// Run N hands
const count = parseInt(process.argv[2] || '5');
console.log(`Playing ${count} self-play hands...\n`);

for (let i = 0; i < count; i++) {
  playHand(generateSeed());
}

console.log(`\n${'='.repeat(60)}`);
console.log(`All ${count} hands completed successfully.`);

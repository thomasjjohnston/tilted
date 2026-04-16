import type { ActionType, BettingState, LegalActionsResult, PlayerState, Street, Action } from './types.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const HANDS_PER_ROUND = 10;

// ── State construction ───────────────────────────────────────────────────────

/**
 * Create the initial preflop betting state after blinds are posted.
 * Blinds have already been deducted from available and added to reservedInHand.
 */
export function createPreflopState(
  sbUserId: string,
  bbUserId: string,
  sbAvailable: number,
  bbAvailable: number,
  blindSmall: number,
  blindBig: number,
): BettingState {
  return {
    street: 'preflop',
    pot: blindSmall + blindBig,
    currentBet: blindBig,
    lastRaiseSize: blindBig, // For min-raise: the initial "raise" is BB itself
    sbUserId,
    bbUserId,
    actionOnUserId: sbUserId, // Preflop: SB acts first in HU
    players: [
      {
        userId: sbUserId,
        available: sbAvailable,
        reservedInHand: blindSmall,
        isAllIn: false,
      },
      {
        userId: bbUserId,
        available: bbAvailable,
        reservedInHand: blindBig,
        isAllIn: false,
      },
    ],
    actionsThisStreet: 0,
    streetClosed: false,
    isTerminal: false,
  };
}

/**
 * Create a new street state (flop/turn/river) from the previous state.
 * Postflop: BB (out of position) acts first in HU.
 */
export function createPostflopState(
  prev: BettingState,
  street: Street,
): BettingState {
  return {
    ...prev,
    street,
    currentBet: 0,
    lastRaiseSize: 0,
    // Postflop: BB acts first in HU
    actionOnUserId: prev.bbUserId,
    actionsThisStreet: 0,
    streetClosed: false,
  };
}

// ── Legal actions ────────────────────────────────────────────────────────────

function getPlayer(state: BettingState, userId: string): PlayerState {
  const p = state.players.find(p => p.userId === userId);
  if (!p) throw new Error(`Player ${userId} not in hand`);
  return p;
}

function getOpponent(state: BettingState, userId: string): PlayerState {
  const p = state.players.find(p => p.userId !== userId);
  if (!p) throw new Error(`No opponent for ${userId}`);
  return p;
}

/**
 * Calculate legal actions for the player whose turn it is.
 */
export function legalActions(state: BettingState): LegalActionsResult {
  if (state.isTerminal || state.streetClosed) {
    return { actions: [], minRaise: 0, maxBet: 0, callAmount: 0, potSize: state.pot };
  }

  const actor = getPlayer(state, state.actionOnUserId);
  const maxCommit = actor.available + actor.reservedInHand;

  const actions: ActionType[] = [];
  let callAmount = 0;
  let minRaise = 0;
  let maxBet = 0;

  if (state.currentBet === 0 || actor.reservedInHand === state.currentBet) {
    // No bet facing us (or we already matched)
    // Can check
    actions.push('check');

    // Can bet (if we have chips)
    if (actor.available > 0) {
      const minBetSize = Math.min(state.lastRaiseSize || 10, actor.available);
      // Bet means "bet" when currentBet is 0
      actions.push('bet');
      minRaise = Math.min(10, actor.available); // min bet = 1 BB = 10
      maxBet = actor.available;

      if (actor.available > 0) {
        actions.push('all_in');
      }
    }
  } else {
    // There's a bet we haven't matched
    const toCall = state.currentBet - actor.reservedInHand;

    // Can always fold
    actions.push('fold');

    if (toCall >= actor.available) {
      // Can only call all-in (for less or exactly)
      actions.push('all_in');
      callAmount = actor.available;
    } else {
      // Can call
      actions.push('call');
      callAmount = toCall;

      // Can raise (if we have enough)
      const minRaiseTotal = state.currentBet + Math.max(state.lastRaiseSize, 10);
      const minRaiseAmount = minRaiseTotal - actor.reservedInHand;

      if (minRaiseAmount <= actor.available) {
        actions.push('raise');
        minRaise = minRaiseAmount;
        maxBet = actor.available;
      }

      // All-in (if more than a call but less than min raise, still valid as all-in)
      if (actor.available > toCall) {
        actions.push('all_in');
      }
    }
  }

  return {
    actions: [...new Set(actions)],
    minRaise,
    maxBet,
    callAmount,
    potSize: state.pot,
  };
}

// ── Action application ───────────────────────────────────────────────────────

/**
 * Apply an action to the betting state. Returns the new state.
 * This is a PURE function — no side effects.
 */
export function applyAction(state: BettingState, action: Action): BettingState {
  if (state.isTerminal) {
    throw new Error('Hand is terminal');
  }
  if (state.streetClosed) {
    throw new Error('Street is closed');
  }

  const actorId = state.actionOnUserId;
  const actor = getPlayer(state, actorId);
  const opponent = getOpponent(state, actorId);
  const legal = legalActions(state);

  if (!legal.actions.includes(action.type)) {
    throw new Error(`Illegal action: ${action.type}. Legal: ${legal.actions.join(', ')}`);
  }

  // Clone state
  const newState: BettingState = {
    ...state,
    players: state.players.map(p => ({ ...p })) as [PlayerState, PlayerState],
    actionsThisStreet: state.actionsThisStreet + 1,
  };

  const newActor = newState.players.find(p => p.userId === actorId)!;
  const newOpponent = newState.players.find(p => p.userId !== actorId)!;

  switch (action.type) {
    case 'fold': {
      newState.isTerminal = true;
      newState.terminalReason = 'fold';
      newState.winnerUserId = opponent.userId;
      newState.actionOnUserId = '';
      newState.streetClosed = true;
      break;
    }

    case 'check': {
      // Check is valid when no bet faces us
      newState.actionOnUserId = opponent.userId;

      // Street closes when both have acted and bets are level
      // Preflop: BB can check to close the street after SB limps
      // Postflop: second player checking closes the street
      if (shouldCloseStreet(newState)) {
        newState.streetClosed = true;
        newState.actionOnUserId = '';
      }
      break;
    }

    case 'call': {
      const toCall = state.currentBet - actor.reservedInHand;
      if (toCall > actor.available) {
        throw new Error(`Cannot call ${toCall} with ${actor.available} available`);
      }
      newActor.available -= toCall;
      newActor.reservedInHand += toCall;
      newState.pot += toCall;

      // Check if we need to go to showdown (both all-in)
      if (newActor.available === 0 && newActor.reservedInHand > 0) {
        newActor.isAllIn = true;
      }

      // Preflop limp: SB calls to match BB, but BB hasn't acted yet.
      // The call only closes the street when the OPPONENT has already acted
      // on this street (i.e., they bet/raised and we're calling).
      // Preflop is special: SB's "call" is completing the blind, BB still gets to act.
      if (state.street === 'preflop' && state.actionsThisStreet === 0 && actorId === state.sbUserId) {
        // SB limps — BB still gets to act
        newState.actionOnUserId = opponent.userId;
      } else {
        // Regular call after a bet/raise — street closes
        newState.streetClosed = true;
        newState.actionOnUserId = '';
      }
      break;
    }

    case 'bet': {
      const amount = action.amount;
      if (amount < Math.min(10, actor.available)) {
        throw new Error(`Bet of ${amount} below minimum`);
      }
      if (amount > actor.available) {
        throw new Error(`Bet of ${amount} exceeds available ${actor.available}`);
      }

      newActor.available -= amount;
      newActor.reservedInHand += amount;
      newState.pot += amount;
      newState.currentBet = newActor.reservedInHand;
      newState.lastRaiseSize = amount;
      newState.actionOnUserId = opponent.userId;
      break;
    }

    case 'raise': {
      const amount = action.amount;
      const newTotal = actor.reservedInHand + amount;
      const raiseSize = newTotal - state.currentBet;
      const minRaiseSize = Math.max(state.lastRaiseSize, 10);

      if (raiseSize < minRaiseSize && amount < actor.available) {
        throw new Error(`Raise of ${raiseSize} below min-raise of ${minRaiseSize}`);
      }
      if (amount > actor.available) {
        throw new Error(`Raise amount ${amount} exceeds available ${actor.available}`);
      }

      newActor.available -= amount;
      newActor.reservedInHand += amount;
      newState.pot += amount;
      newState.currentBet = newActor.reservedInHand;
      newState.lastRaiseSize = raiseSize;
      newState.actionOnUserId = opponent.userId;
      break;
    }

    case 'all_in': {
      const amount = actor.available;
      const newTotal = actor.reservedInHand + amount;

      newActor.available = 0;
      newActor.reservedInHand = newTotal;
      newActor.isAllIn = true;
      newState.pot += amount;

      if (newTotal > state.currentBet) {
        // This is a bet/raise that happens to be all-in
        const raiseSize = newTotal - state.currentBet;
        newState.lastRaiseSize = Math.max(raiseSize, state.lastRaiseSize);
        newState.currentBet = newTotal;
        newState.actionOnUserId = opponent.userId;
      } else {
        // Calling all-in for less or exactly
        // If opponent is also all-in, or we matched the bet, street closes
        if (opponent.isAllIn || newTotal === state.currentBet) {
          newState.streetClosed = true;
          newState.actionOnUserId = '';
        } else {
          // We called for less — opponent doesn't need to act again, street closes
          // Excess returned to opponent happens at showdown
          newState.streetClosed = true;
          newState.actionOnUserId = '';
        }
      }

      // If both players are all-in, hand goes to awaiting_runout
      if (newActor.isAllIn && newOpponent.isAllIn) {
        newState.streetClosed = true;
        newState.actionOnUserId = '';
      }
      break;
    }
  }

  return newState;
}

/**
 * Check if the street should close after a check action.
 */
function shouldCloseStreet(state: BettingState): boolean {
  // Both players' bets must be equal and both must have acted
  const [p1, p2] = state.players;
  const betsEqual = p1.reservedInHand === p2.reservedInHand ||
    state.currentBet === 0;

  if (state.street === 'preflop') {
    // Preflop: BB checking after SB limps closes the street
    // SB limps (call to BB level) → BB checks → street closed
    // This happens when BB has had their chance to act
    if (state.actionOnUserId === state.sbUserId && state.actionsThisStreet >= 2) {
      return true;
    }
    // BB checks (only possible after SB has completed to BB, then BB checks)
    if (state.actionsThisStreet >= 2 && betsEqual) {
      return true;
    }
    return false;
  }

  // Postflop: second check closes the street
  if (state.actionsThisStreet >= 2 && betsEqual) {
    return true;
  }

  return false;
}

/**
 * Determine if both players are all-in (no more betting possible).
 */
export function bothAllIn(state: BettingState): boolean {
  return state.players.every(p => p.isAllIn);
}

/**
 * Get the next street after the current one.
 */
export function nextStreet(current: Street): Street | 'showdown' {
  switch (current) {
    case 'preflop': return 'flop';
    case 'flop': return 'turn';
    case 'turn': return 'river';
    case 'river': return 'showdown';
  }
}

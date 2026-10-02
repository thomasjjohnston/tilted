// Untilted's decision logic — pure: strategy access is injected, no db here.
//
// Per pending hand: rebuild the real betting picture from recorded action
// rows, translate it into the abstract solver game, bucket the bot's hand,
// look up the trained mixed strategy, sample deterministically, and map the
// abstract choice back onto a legal real Tilted action.

import type { Card } from '../types.js';
import { assignBucket, preflopClass } from './bucketing.js';
import {
  SolverBetState,
  type SolverConfig,
  TOK_ALLIN,
  TOK_CALL,
  TOK_FOLD,
} from './betting.js';
import { translateHand, type RealAction } from './mapper.js';

export interface RecordedAction {
  actingUserId: string;
  actionType: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';
  /** Chip increment committed by this action (Tilted convention). */
  amount: number;
  street: string;
}

export interface BotHandInput {
  handId: string;
  botIsSb: boolean;
  holeCards: [Card, Card];
  board: Card[];
  actionRows: RecordedAction[];
  sbUserId: string;
  /** Whole-hand reserved chips per player (includes blinds). */
  myReserved: number;
  oppReserved: number;
  /** Round-level available chips (public info in Tilted). */
  myAvailable: number;
  oppAvailable: number;
}

export interface BotDecision {
  actionType: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';
  amount: number; // increment semantics; 0 where the server computes it
  /** Diagnostics for logs/tests. */
  meta: {
    depthBb: number;
    seq: string;
    bucket: number;
    chosenToken: string;
    offBook: boolean;
  };
}

export type StrategyLookup = (
  depthBb: number,
  street: number,
  seq: string,
  bucket: number,
) => Promise<{ tokens: string[]; strategy: number[] } | null>;

interface RealBettingPicture {
  realActions: RealAction[];
  /** Current-street contribution per player index (0 = SB). */
  streetTo: [number, number];
  lastRaiseIncrement: number;
  street: number;
}

const STREET_INDEX: Record<string, number> = { preflop: 0, flop: 1, turn: 2, river: 3 };

/**
 * Rebuild player-indexed actions with street bet-to amounts from Tilted's
 * increment-based action rows. Blinds are implicit (posted at deal), exactly
 * as in the abstract game.
 */
export function rebuildRealPicture(
  rows: RecordedAction[],
  sbUserId: string,
  blindSmall: number,
  blindBig: number,
): RealBettingPicture {
  const realActions: RealAction[] = [];
  let street = 0;
  let streetTo: [number, number] = [blindSmall, blindBig];
  let lastRaise = blindBig - blindSmall;

  for (const row of rows) {
    const rowStreet = STREET_INDEX[row.street];
    if (rowStreet !== street) {
      street = rowStreet;
      streetTo = [0, 0];
      lastRaise = 0;
    }
    const player = row.actingUserId === sbUserId ? 0 : 1;
    const opp = 1 - player;
    switch (row.actionType) {
      case 'fold':
        realActions.push({ player, kind: 'fold' });
        break;
      case 'check':
        realActions.push({ player, kind: 'check' });
        break;
      case 'call':
        streetTo[player] += row.amount;
        realActions.push({ player, kind: 'call' });
        break;
      case 'bet':
      case 'raise':
      case 'all_in': {
        const to = streetTo[player] + row.amount;
        const increment = to - streetTo[opp];
        if (increment > lastRaise) lastRaise = increment;
        streetTo[player] = to;
        realActions.push({
          player,
          kind: row.actionType === 'all_in' ? 'all_in' : row.actionType,
          to,
        });
        break;
      }
    }
  }
  return { realActions, streetTo, lastRaiseIncrement: lastRaise, street };
}

/** Deterministic per-decision RNG: retries of the same spot pick the same action. */
function decisionRoll(handId: string, seq: string): number {
  let h = 0x811c9dc5;
  const s = `${handId}|${seq}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

export async function decideBotHand(
  input: BotHandInput,
  config: SolverConfig,
  buckets: { flop: number[]; turn: number[]; river: number[]; ehs_samples: number },
  depths: number[],
  lookup: StrategyLookup,
): Promise<BotDecision> {
  const botPlayer = input.botIsSb ? 0 : 1;
  const bb = config.blind_big;

  // Effective stack (spec §7): each side's ceiling for THIS hand.
  const effective = Math.max(
    bb * 2,
    Math.min(input.myAvailable + input.myReserved, input.oppAvailable + input.oppReserved),
  );
  const depthBb = nearest(depths, effective / bb);

  // Real picture from recorded rows; abstract picture via translation.
  const real = rebuildRealPicture(
    input.actionRows, input.sbUserId, config.blind_small, config.blind_big,
  );
  const spot = translateHand(config, depthBb, real.realActions);
  const state = spot.state;
  if (state.terminal !== null || state.toAct !== botPlayer) {
    throw new Error(
      `bot decision requested but abstract state disagrees ` +
      `(terminal=${state.terminal}, toAct=${state.toAct}, bot=${botPlayer})`,
    );
  }

  const bucket = input.board.length === 0
    ? preflopClass(input.holeCards[0], input.holeCards[1])
    : assignBucket(state.street, input.holeCards, input.board, buckets);

  const legal = state.legalActions();
  const row = await lookup(depthBb, state.street, spot.seq, bucket);

  let chosenToken: string | null = null;
  let offBook = false;
  if (row) {
    // Renormalize the trained mix over the currently legal tokens (menus can
    // differ at the all-in margins when real stacks are off-grid).
    const weight = new Map(row.tokens.map((t, i) => [t, row.strategy[i]]));
    const shared = legal.filter(a => weight.has(a.token));
    const total = shared.reduce((s, a) => s + (weight.get(a.token) ?? 0), 0);
    if (shared.length > 0 && total > 1e-9) {
      let roll = decisionRoll(input.handId, spot.seq) * total;
      chosenToken = shared[shared.length - 1].token;
      for (const a of shared) {
        roll -= weight.get(a.token) ?? 0;
        if (roll <= 0) {
          chosenToken = a.token;
          break;
        }
      }
    }
  }
  if (chosenToken === null) {
    // Off-book: passive but never face-up — check when free, else fold to
    // large bets, call small ones (a fixed, unexploitable-enough default).
    offBook = true;
    const toCall = state.streetTo[1 - botPlayer] - state.streetTo[botPlayer];
    if (toCall <= 0) chosenToken = TOK_CALL;
    else chosenToken = toCall <= 2 * bb ? TOK_CALL : TOK_FOLD;
  }

  const decision = mapToReal(chosenToken, state, real, input, config);
  return {
    ...decision,
    meta: { depthBb, seq: spot.seq, bucket, chosenToken, offBook },
  };
}

function nearest(depths: number[], targetBb: number): number {
  let best = depths[0];
  for (const d of depths) {
    if (Math.abs(d - targetBb) < Math.abs(best - targetBb)) best = d;
  }
  return best;
}

/** Map an abstract token to a legal real Tilted action (increment amounts). */
function mapToReal(
  token: string,
  state: SolverBetState,
  real: RealBettingPicture,
  input: BotHandInput,
  config: SolverConfig,
): Omit<BotDecision, 'meta'> {
  const botPlayer = input.botIsSb ? 0 : 1;
  const opp = 1 - botPlayer;
  const myTo = real.streetTo[botPlayer];
  const oppTo = real.streetTo[opp];
  const toCall = Math.max(0, oppTo - myTo);
  const bb = config.blind_big;

  if (token === TOK_FOLD) return { actionType: 'fold', amount: 0 };
  if (token === TOK_CALL) {
    if (toCall === 0) return { actionType: 'check', amount: 0 };
    if (toCall >= input.myAvailable) return { actionType: 'all_in', amount: 0 };
    return { actionType: 'call', amount: 0 };
  }
  if (token === TOK_ALLIN) return { actionType: 'all_in', amount: 0 };

  // Menu raise: recompute the trained size formula against the REAL state so
  // off-menu opponent sizes still produce sensible targets.
  const abstractAction = state.legalActions().find(a => a.token === token);
  if (!abstractAction) return { actionType: toCall > 0 ? 'call' : 'check', amount: 0 };
  const idx = Number(token.slice(1));
  const m = config.bet_menus;
  const streetName = SOLVER_STREET_NAMES[real.street];
  let sizes: number[];
  if (real.street === 0) {
    sizes = state.raisesThisStreet === 0 ? m.preflop_opens : m.preflop_raises;
  } else {
    sizes = [...m[streetName as 'flop' | 'turn' | 'river']];
    if (state.depthBb >= m.overbet_min_depth_bb && m.overbet_streets.includes(streetName)) {
      sizes.push(...m.overbet);
    }
  }
  const size = sizes[idx] ?? sizes[sizes.length - 1];
  const potReal = input.myReserved + input.oppReserved;
  let targetTo: number;
  if (real.street === 0) {
    targetTo = state.raisesThisStreet === 0
      ? Math.floor(size * bb + 0.5)
      : Math.floor(size * oppTo + 0.5);
  } else if (toCall === 0) {
    targetTo = Math.floor(size * potReal + 0.5);
  } else {
    targetTo = oppTo + Math.floor(size * (potReal + toCall) + 0.5);
  }
  targetTo = Math.floor((targetTo + 2) / 5) * 5;
  // Real min-raise clamp.
  const minTo = toCall > 0 || real.street === 0
    ? oppTo + Math.max(real.lastRaiseIncrement, bb)
    : Math.max(bb, myTo + bb);
  targetTo = Math.max(targetTo, minTo);

  const increment = targetTo - myTo;
  if (increment >= input.myAvailable) return { actionType: 'all_in', amount: 0 };
  const isBet = toCall === 0 && real.street !== 0;
  return { actionType: isBet ? 'bet' : 'raise', amount: increment };
}

const SOLVER_STREET_NAMES = ['preflop', 'flop', 'turn', 'river'] as const;

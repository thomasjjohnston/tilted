// Spot mapper: translate a real Tilted hand's action history into the
// abstract solver game, snapping arbitrary bet sizes onto the trained menu.
// Port of tools/solver/tilted_solver/mapper.py; pinned by conformance vectors.

import {
  SolverBetState,
  type SolverAction,
  type SolverConfig,
  TOK_ALLIN,
  TOK_CALL,
  TOK_FOLD,
} from './betting.js';

export interface RealAction {
  /** 0 = SB/button, 1 = BB (solver-game player index, not Tilted user id). */
  player: number;
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';
  /** Street bet-to amount for bet/raise/all_in. */
  to?: number;
}

export interface MappedSpot {
  depthBb: number;
  street: number;
  seq: string;
  state: SolverBetState;
  /** Abstract token chosen for each real action (diagnostics). */
  translation: string[];
}

/** Distance in log space — scale-robust, standard for action translation. */
function geometricDistance(a: number, b: number): number {
  if (a <= 0 || b <= 0) return Infinity;
  return Math.abs(Math.log(a) - Math.log(b));
}

export function translateHand(
  config: SolverConfig,
  depthBb: number,
  actions: RealAction[],
  stackChips?: number,
): MappedSpot {
  const state = new SolverBetState(config, depthBb, stackChips);
  const translation: string[] = [];

  for (const act of actions) {
    if (state.terminal !== null) {
      throw new Error('real hand continues past abstract terminal');
    }
    if (act.player !== state.toAct) {
      throw new Error(`action order mismatch: real ${act.player} vs abstract ${state.toAct}`);
    }
    const legal = state.legalActions();
    const chosen = translateAction(act, legal);
    translation.push(chosen.token);
    state.apply(chosen);
  }

  return {
    depthBb,
    street: state.street,
    seq: state.seqStr(),
    state,
    translation,
  };
}

function translateAction(act: RealAction, legal: SolverAction[]): SolverAction {
  const byToken = new Map(legal.map(a => [a.token, a]));
  if (act.kind === 'fold') return byToken.get(TOK_FOLD)!;
  if (act.kind === 'check' || act.kind === 'call') return byToken.get(TOK_CALL)!;
  if (act.kind === 'all_in') {
    // Facing an all-in the abstract state can't re-raise: treat as call.
    return byToken.get(TOK_ALLIN) ?? byToken.get(TOK_CALL)!;
  }
  // bet / raise: snap to the nearest aggressive action geometrically.
  if (act.to === undefined) throw new Error(`${act.kind} requires a to amount`);
  const aggressive = legal.filter(a => a.token !== TOK_FOLD && a.token !== TOK_CALL);
  if (aggressive.length === 0) return byToken.get(TOK_CALL)!;
  let best = aggressive[0];
  let bestD = geometricDistance(best.to, act.to);
  for (const a of aggressive.slice(1)) {
    const d = geometricDistance(a.to, act.to);
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/**
 * Effective stack for one Tilted hand (spec §7): each player's ceiling is
 * available chips plus what they already reserved in THIS hand; the hand
 * plays for the smaller ceiling.
 */
export function effectiveStack(
  myAvailable: number,
  myReservedInHand: number,
  oppAvailable: number,
  oppReservedInHand: number,
): number {
  return Math.max(0, Math.min(myAvailable + myReservedInHand, oppAvailable + oppReservedInHand));
}

// Abstract solver-game betting engine.
//
// This is the menu-constrained heads-up game the offline solver was trained
// on (tools/solver). It is NOT Tilted's real betting engine — it exists so
// the server can map real hand states onto trained-strategy lookups.
//
// Faithful port of tools/solver/tilted_solver/betting.py, which is itself
// conformance-pinned to the Rust trainer. Every rule here is held to the
// Python implementation by test/engine/solver-betting.test.ts replaying
// generated vectors — do not "fix" behavior here without regenerating them.

export const SOLVER_STREETS = ['preflop', 'flop', 'turn', 'river'] as const;

export const TOK_FOLD = 'f';
export const TOK_CALL = 'c';
export const TOK_ALLIN = 'a';
export const TOK_STREET = '/';
export const MAX_TOKENS = 32;

/** Bet-menu configuration; key names match the artifact's config JSON. */
export interface SolverBetMenus {
  preflop_opens: number[];
  preflop_raises: number[];
  flop: number[];
  turn: number[];
  river: number[];
  overbet: number[];
  overbet_min_depth_bb: number;
  overbet_streets: string[];
  near_allin_prune: number;
  raise_cap: number;
}

export interface SolverConfig {
  blind_small: number;
  blind_big: number;
  bet_menus: SolverBetMenus;
  // `buckets` config also rides along in the artifact meta; unused here.
  [key: string]: unknown;
}

export interface SolverAction {
  token: string;
  /** Street "bet to" amount after the action (0 for fold). */
  to: number;
}

export type SolverTerminal = 'fold0' | 'fold1' | 'showdown';

/** Rust f64::round semantics for positive values (Math.round differs on
 * negative halves only, but stay explicit — bet sizing must match exactly). */
function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

export class SolverBetState {
  readonly config: SolverConfig;
  readonly depthBb: number;
  readonly stack: number;
  street = 0;
  committed: [number, number];
  streetTo: [number, number];
  lastRaise: number;
  raisesThisStreet = 0;
  acted: [boolean, boolean] = [false, false];
  toAct = 0; // player 0 = SB/button, acts first preflop, second postflop
  terminal: SolverTerminal | null = null;
  seq: string[] = [];

  constructor(config: SolverConfig, depthBb: number, stackChips?: number) {
    this.config = config;
    this.depthBb = depthBb;
    const bb = config.blind_big;
    const sb = config.blind_small;
    this.stack = stackChips ?? depthBb * bb;
    this.committed = [sb, bb];
    this.streetTo = [sb, bb];
    this.lastRaise = bb - sb;
  }

  pot(): number {
    return this.committed[0] + this.committed[1];
  }

  isAllIn(p: number): boolean {
    return this.committed[p] >= this.stack;
  }

  allinTo(): number {
    const me = this.toAct;
    return this.stack - (this.committed[me] - this.streetTo[me]);
  }

  /** Menu of (index, to) raise sizes — mirrors betting.py `_menu`. */
  private menu(): Array<[number, number]> {
    const m = this.config.bet_menus;
    const me = this.toAct;
    const opp = 1 - me;
    const facing = this.streetTo[opp] > this.streetTo[me];
    const oppTo = this.streetTo[opp];
    const pot0 = this.pot();
    const callAmount = Math.max(0, oppTo - this.streetTo[me]);
    const potIfCall = pot0 + callAmount;
    const bb = this.config.blind_big;
    const streetName = SOLVER_STREETS[this.street];

    let sizes: number[];
    if (this.street === 0) {
      sizes = this.raisesThisStreet === 0 ? [...m.preflop_opens] : [...m.preflop_raises];
    } else {
      sizes = [...(m[streetName as 'flop' | 'turn' | 'river'])];
      if (this.depthBb >= m.overbet_min_depth_bb && m.overbet_streets.includes(streetName)) {
        sizes.push(...m.overbet);
      }
    }

    const out: Array<[number, number]> = [];
    const allinTo = this.allinTo();
    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i];
      let rawTo: number;
      if (this.street === 0) {
        rawTo = this.raisesThisStreet === 0 ? roundHalfUp(size * bb) : roundHalfUp(size * oppTo);
      } else if (!facing) {
        rawTo = roundHalfUp(size * pot0);
      } else {
        rawTo = oppTo + roundHalfUp(size * potIfCall);
      }
      let to = Math.floor((rawTo + 2) / 5) * 5;
      const minTo = facing || this.street === 0
        ? oppTo + Math.max(this.lastRaise, bb)
        : bb;
      to = Math.max(to, minTo);
      if (to >= (1.0 - m.near_allin_prune) * allinTo) continue;
      out.push([i, to]);
    }
    // Dedup identical amounts, keeping the first.
    const seen = new Set<number>();
    return out.filter(([, to]) => (seen.has(to) ? false : (seen.add(to), true)));
  }

  legalActions(): SolverAction[] {
    if (this.terminal !== null) throw new Error('no actions at a terminal state');
    const me = this.toAct;
    const opp = 1 - me;
    const facing = this.streetTo[opp] > this.streetTo[me];
    const out: SolverAction[] = [];

    if (facing) out.push({ token: TOK_FOLD, to: 0 });
    const callTo = Math.min(this.streetTo[opp], this.allinTo());
    out.push({ token: TOK_CALL, to: callTo });

    const oppAllIn = this.committed[opp] >= this.stack;
    if (!oppAllIn && this.seq.length < MAX_TOKENS - 2) {
      if (this.raisesThisStreet < this.config.bet_menus.raise_cap) {
        for (const [i, to] of this.menu()) {
          if (to > this.streetTo[opp] && to < this.allinTo()) {
            out.push({ token: `r${i}`, to });
          }
        }
      }
      const allin = this.allinTo();
      if (allin > this.streetTo[opp]) out.push({ token: TOK_ALLIN, to: allin });
    }
    return out;
  }

  apply(action: SolverAction): void {
    const me = this.toAct;
    const opp = 1 - me;
    this.seq.push(action.token);

    if (action.token === TOK_FOLD) {
      this.terminal = me === 0 ? 'fold0' : 'fold1';
      return;
    }

    if (action.token === TOK_CALL) {
      const delta = action.to - this.streetTo[me];
      this.streetTo[me] = action.to;
      this.committed[me] += delta;
      this.acted[me] = true;
    } else {
      const delta = action.to - this.streetTo[me];
      const increment = Math.max(0, action.to - this.streetTo[opp]);
      this.streetTo[me] = action.to;
      this.committed[me] += delta;
      this.acted[me] = true;
      if (increment > this.lastRaise) this.lastRaise = increment;
      this.raisesThisStreet += 1;
    }

    const matched =
      this.streetTo[me] === this.streetTo[opp] || this.isAllIn(me) || this.isAllIn(opp);
    const closing = action.token === TOK_CALL;
    if (closing && this.acted[me] && this.acted[opp] && matched) {
      const someoneAllIn = this.isAllIn(0) || this.isAllIn(1);
      if (this.street === 3 || someoneAllIn) {
        this.terminal = 'showdown';
      } else {
        this.street += 1;
        this.streetTo = [0, 0];
        this.lastRaise = 0;
        this.raisesThisStreet = 0;
        this.acted = [false, false];
        this.toAct = 1; // BB acts first postflop
        this.seq.push(TOK_STREET);
      }
      return;
    }
    this.toAct = opp;
  }

  seqStr(): string {
    return this.seq.join('');
  }
}

/** Split a seq string like "r0c/cr1c/" into tokens. */
export function tokenizeSeq(seq: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < seq.length) {
    const ch = seq[i];
    if (ch === 'f' || ch === 'c' || ch === 'a' || ch === '/') {
      out.push(ch);
      i += 1;
    } else if (ch === 'r') {
      let j = i + 1;
      while (j < seq.length && seq[j] >= '0' && seq[j] <= '9') j += 1;
      out.push(seq.slice(i, j));
      i = j;
    } else {
      throw new Error(`bad token char ${ch} in ${seq}`);
    }
  }
  return out;
}

// Fit a bot turn to the shared stack — pure.
//
// The bot decides each pending hand independently, as if the whole stack
// were available to that hand. But a Tilted turn is one all-or-nothing
// batch drawn from ONE stack (spec §6): ten independent decisions can add
// up to more chips than exist, and the server then rejects the entire turn.
// This pass walks the decisions in order with a running balance and
// downgrades whatever no longer fits, so the batch is always legal.

export type BotActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';

export interface BudgetInput {
  handId: string;
  actionType: BotActionType;
  /** Chip increment for bet/raise; ignored otherwise. */
  amount: number;
  /** Chips this hand needs from the bot just to call (0 = may check). */
  toCall: number;
}

export interface BudgetedAction {
  handId: string;
  actionType: BotActionType;
  amount: number;
  /** True when the original decision was changed to fit the stack. */
  adjusted: boolean;
}

/**
 * Returns one action per input, in submission order: everything that keeps
 * chips behind first (original order), then at most one real all-in last so
 * it only takes what the other hands left.
 */
export function fitTurnToStack(decisions: BudgetInput[], available: number): BudgetedAction[] {
  let remaining = Math.max(0, available);
  const paced: BudgetedAction[] = [];
  const shoves: BudgetInput[] = [];

  /** Cheapest way to stay in / get out when the wish can't be afforded. */
  const passive = (d: BudgetInput, adjusted: boolean): BudgetedAction | null => {
    if (d.toCall === 0) return { handId: d.handId, actionType: 'check', amount: 0, adjusted };
    if (d.toCall < remaining) {
      remaining -= d.toCall;
      return { handId: d.handId, actionType: 'call', amount: 0, adjusted };
    }
    return null; // calling would take the whole stack: decide with the shoves
  };

  for (const d of decisions) {
    switch (d.actionType) {
      case 'fold':
        paced.push({ handId: d.handId, actionType: 'fold', amount: 0, adjusted: false });
        break;
      case 'check':
      case 'call': {
        const a = passive(d, d.actionType === 'check' && d.toCall > 0);
        if (a) paced.push(a); else shoves.push(d);
        break;
      }
      case 'bet':
      case 'raise':
        if (d.amount > 0 && d.amount < remaining) {
          remaining -= d.amount;
          paced.push({ handId: d.handId, actionType: d.actionType, amount: d.amount, adjusted: false });
        } else {
          // Can't afford the raise: don't turn it into an accidental shove.
          const a = passive(d, true);
          if (a) paced.push(a); else shoves.push(d);
        }
        break;
      case 'all_in':
        shoves.push(d);
        break;
    }
  }

  const tail: BudgetedAction[] = [];
  for (const d of shoves) {
    if (remaining > 0) {
      remaining = 0;
      tail.push({ handId: d.handId, actionType: 'all_in', amount: 0, adjusted: d.actionType !== 'all_in' });
    } else if (d.toCall === 0) {
      tail.push({ handId: d.handId, actionType: 'check', amount: 0, adjusted: true });
    } else {
      tail.push({ handId: d.handId, actionType: 'fold', amount: 0, adjusted: true });
    }
  }
  return [...paced, ...tail];
}

/**
 * Last-resort turn that is legal whatever the bot wished: check when free,
 * call while it fits, otherwise fold. Used if a budgeted turn is still
 * rejected, so a bot match can never get stuck on an illegal batch.
 */
export function passiveTurn(decisions: BudgetInput[], available: number): BudgetedAction[] {
  let remaining = Math.max(0, available);
  return decisions.map((d) => {
    if (d.toCall === 0) return { handId: d.handId, actionType: 'check' as const, amount: 0, adjusted: true };
    if (d.toCall < remaining) {
      remaining -= d.toCall;
      return { handId: d.handId, actionType: 'call' as const, amount: 0, adjusted: true };
    }
    return { handId: d.handId, actionType: 'fold' as const, amount: 0, adjusted: true };
  });
}

"""Portfolio layer: allocate a shared chip budget across pending hands.

Each pending hand contributes a set of candidate actions (chip cost now,
estimated EV). Exactly one candidate per hand must be chosen subject to
sum(cost) <= budget — a multiple-choice knapsack, solved exactly by DP over
budget in 5-chip units.

Knobs:
- shadow_price: chips valued above face value when scarce. Implemented as a
  penalty (lambda - 1) * cost applied to candidate values, discouraging
  marginal spends when the budget is tight.
- temperature: Gumbel-perturbed re-solve for near-optimal sampling, so the
  engine's allocation isn't a deterministic tell (see design discussion:
  "his biggest bet is always his best hand").
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

CHIP_UNIT = 5


@dataclass(frozen=True)
class Candidate:
    hand_id: str
    label: str  # token or human label, e.g. "r1 (bet 75)"
    cost: int  # additional chips this action commits NOW
    ev: float  # estimated EV (chips) of the hand playing this line
    meta: dict | None = None


@dataclass
class Allocation:
    chosen: dict[str, Candidate]
    total_ev: float
    total_cost: int
    budget: int
    shadow_price: float


def solve(
    hands: list[list[Candidate]],
    budget: int,
    shadow_price: float = 1.0,
    temperature: float = 0.0,
    rng: random.Random | None = None,
) -> Allocation:
    """Exact multiple-choice knapsack over the candidate sets.

    Every hand must pick exactly one candidate. Raises ValueError if no
    feasible assignment fits the budget (can't happen when every hand has a
    zero-cost option — fold/check always are).
    """
    if not hands:
        return Allocation({}, 0.0, 0, budget, shadow_price)
    rng = rng or random.Random()

    def value_of(c: Candidate) -> float:
        v = c.ev - (shadow_price - 1.0) * c.cost
        if temperature > 0.0:
            # Gumbel noise scaled by temperature: re-solving samples from a
            # softmax-like distribution over near-optimal allocations.
            v += temperature * -math.log(-math.log(max(rng.random(), 1e-12)))
        return v

    values: list[list[float]] = [[value_of(c) for c in cands] for cands in hands]
    # DP table is small (10 hands x ~400 budget states for a 2000-chip stack).
    return _solve_full(hands, values, budget, shadow_price)


def _solve_full(
    hands: list[list[Candidate]],
    values: list[list[float]],
    budget: int,
    shadow_price: float,
) -> Allocation:
    units = budget // CHIP_UNIT
    n_states = units + 1
    neg_inf = float("-inf")
    n = len(hands)

    # dp[i][b]: best value for hands[i:] with b units remaining. Iterate backwards.
    dp = [[neg_inf] * n_states for _ in range(n + 1)]
    take = [[-1] * n_states for _ in range(n)]
    for b in range(n_states):
        dp[n][b] = 0.0
    for i in range(n - 1, -1, -1):
        for b in range(n_states):
            best = neg_inf
            best_c = -1
            for ci, c in enumerate(hands[i]):
                cost_units = (c.cost + CHIP_UNIT - 1) // CHIP_UNIT
                if cost_units > b:
                    continue
                v = values[i][ci] + dp[i + 1][b - cost_units]
                if v > best:
                    best = v
                    best_c = ci
            dp[i][b] = best
            take[i][b] = best_c

    if dp[0][units] == neg_inf:
        raise ValueError("no feasible allocation within budget")

    chosen: dict[str, Candidate] = {}
    b = units
    total_cost = 0
    total_ev = 0.0
    for i, cands in enumerate(hands):
        ci = take[i][b]
        c = cands[ci]
        chosen[c.hand_id] = c
        cost_units = (c.cost + CHIP_UNIT - 1) // CHIP_UNIT
        b -= cost_units
        total_cost += c.cost
        total_ev += c.ev
    return Allocation(chosen, total_ev, total_cost, budget, shadow_price)


def marginal_chip_value(hands: list[list[Candidate]], budget: int) -> float:
    """Empirical shadow price: EV gained by the last CHIP_UNITs of budget.
    Used to surface 'how tight is the budget' in the Lab UI."""
    if budget < CHIP_UNIT * 2:
        return 0.0
    full = _solve_values(hands, budget)
    reduced = _solve_values(hands, budget - CHIP_UNIT * 2)
    return max(0.0, (full - reduced) / (CHIP_UNIT * 2))


def _solve_values(hands: list[list[Candidate]], budget: int) -> float:
    values = [[c.ev for c in cands] for cands in hands]
    return _solve_full(hands, values, budget, 1.0).total_ev

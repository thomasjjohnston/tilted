"""Knapsack allocator tests, including brute-force cross-checks."""

import itertools
import random

from tilted_solver.knapsack import Candidate, marginal_chip_value, solve


def brute_force(hands, budget):
    best = None
    for combo in itertools.product(*hands):
        cost = sum(c.cost for c in combo)
        if cost > budget:
            continue
        ev = sum(c.ev for c in combo)
        if best is None or ev > best[0]:
            best = (ev, combo)
    return best


def _mk(hand_id, options):
    return [Candidate(hand_id, f"{hand_id}-{i}", cost, ev) for i, (cost, ev) in enumerate(options)]


def test_matches_brute_force_on_random_instances():
    rng = random.Random(42)
    for trial in range(50):
        hands = []
        for h in range(rng.randint(1, 6)):
            options = [(0, rng.uniform(-20, 5))]  # always a free option
            for _ in range(rng.randint(1, 4)):
                options.append((rng.randrange(0, 300, 5), rng.uniform(-50, 120)))
            hands.append(_mk(f"h{h}", options))
        budget = rng.randrange(0, 600, 5)
        alloc = solve(hands, budget)
        bf_ev, _ = brute_force(hands, budget)
        assert abs(alloc.total_ev - bf_ev) < 1e-9, f"trial {trial}: dp {alloc.total_ev} vs bf {bf_ev}"
        assert alloc.total_cost <= budget


def test_budget_forces_tradeoff():
    # Two hands both want a 100-chip jam worth +50; budget only fits one.
    hands = [
        _mk("a", [(0, 0.0), (100, 50.0)]),
        _mk("b", [(0, 0.0), (100, 40.0)]),
    ]
    alloc = solve(hands, budget=100)
    assert alloc.chosen["a"].cost == 100, "higher-EV hand gets the budget"
    assert alloc.chosen["b"].cost == 0
    # With a full budget, both jam.
    alloc2 = solve(hands, budget=200)
    assert alloc2.chosen["a"].cost == 100 and alloc2.chosen["b"].cost == 100


def test_shadow_price_discourages_marginal_spends():
    hands = [_mk("a", [(0, 0.0), (100, 4.0)])]  # +4 EV for 100 chips: thin
    assert solve(hands, budget=500).chosen["a"].cost == 100
    assert solve(hands, budget=500, shadow_price=1.1).chosen["a"].cost == 0


def test_temperature_samples_near_optimal_variety():
    hands = [
        _mk("a", [(0, 0.0), (50, 30.0)]),
        _mk("b", [(0, 0.0), (50, 29.5)]),  # nearly identical EV
    ]
    picks = set()
    for seed in range(40):
        alloc = solve(hands, budget=50, temperature=5.0, rng=random.Random(seed))
        picks.add(tuple(sorted((k, c.cost) for k, c in alloc.chosen.items())))
    assert len(picks) > 1, "temperature should produce allocation variety on near-ties"
    # Zero temperature is deterministic argmax.
    fixed = {
        tuple(sorted((k, c.cost) for k, c in solve(hands, budget=50, rng=random.Random(s)).chosen.items()))
        for s in range(10)
    }
    assert len(fixed) == 1


def test_marginal_chip_value_positive_when_binding():
    hands = [
        _mk("a", [(0, 0.0), (100, 50.0)]),
        _mk("b", [(0, 0.0), (100, 40.0)]),
    ]
    assert marginal_chip_value(hands, budget=100) > 0
    assert marginal_chip_value(hands, budget=1000) == 0.0

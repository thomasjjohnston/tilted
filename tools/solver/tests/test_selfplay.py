"""Self-play harness tests: evaluator parity, ledger safety, smoke run."""

import random

from tilted_solver.cards import parse_cards
from tilted_solver.eval7 import eval7


def test_eval7_known_hands():
    cases = [
        ("Ah Kh Qh Jh Th 2c 3d", 8),
        ("5h 4h 3h 2h Ah 9c 9d", 8),
        ("9c 9d 9h 9s Kd 2c 3c", 7),
        ("9c 9d 9h Ks Kd 2c 3c", 6),
        ("Ah 9h 7h 4h 2h Kc Qd", 5),
        ("9c 8d 7h 6s 5d Ac Kd", 4),
        ("5h 4d 3c 2s Ad Kc 9h", 4),
        ("9c 9d 9h Ks Qd 2c 3c", 3),
        ("9c 9d Kh Ks Qd 2c 3c", 2),
        ("9c 9d Kh Qs Jd 2c 3c", 1),
        ("Ac Kd 9h 7s 5d 3c 2h", 0),
    ]
    for s, cat in cases:
        assert eval7(parse_cards(s)) >> 20 == cat, f"category mismatch for {s}"


def test_eval7_ordering_sanity():
    better = eval7(parse_cards("Ah As Ad 2c 7h 9s Jd"))  # trip aces
    worse = eval7(parse_cards("Kh Ks Kd 2c 7h 9s Jd"))  # trip kings
    assert better > worse


def test_selfplay_smoke(pilot_artifact):
    """A few duplicate rounds must complete with chips conserved throughout."""
    from tilted_solver.artifact import _default_kernel_bin
    from tilted_solver.bucket_client import BucketClient
    from tilted_solver.selfplay import Agent, HANDS_PER_ROUND, play_round

    art = pilot_artifact
    rng = random.Random(7)
    buckets = BucketClient(_default_kernel_bin(), art.buckets_file())
    try:
        advisor = Agent("advisor", art, buckets, rng=random.Random(1))
        solo = Agent("solo", art, buckets, rng=random.Random(2))
        for r in range(4):
            deals = []
            for _ in range(HANDS_PER_ROUND):
                deck = rng.sample(range(52), 9)
                deals.append((deck[0:2], deck[2:4], deck[4:9]))
            deltas = play_round(
                {0: advisor, 1: solo}, art, [400, 400], deals, sb_seat=r % 2
            )
            assert deltas[0] + deltas[1] == 0, "chips must be conserved"
            assert abs(deltas[0]) <= 2500, "delta bounded by total exposure"
    finally:
        buckets.close()

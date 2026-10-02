"""Generate bucketing-parity fixtures for the TS port.

The TS side deliberately uses its own PRNG for the E[HS] Monte Carlo (see
apps/server/src/engine/solver/bucketing.ts), so parity is statistical, not
bit-exact: the fixtures pin Python's EHS/bucket per case and the TS test
asserts agreement within Monte Carlo noise, exact preflop classes, and
matching partition semantics.

Run: uv run python -m tilted_solver.genbucketvectors <artifact> <out.json>
"""

from __future__ import annotations

import json
import random
import sys

from .artifact import Artifact
from .cards import card_str, cards_str, preflop_class

CASES_PER_STREET = 40
SEED = 20260705


def main() -> int:
    artifact_path, out_path = sys.argv[1], sys.argv[2]
    art = Artifact(artifact_path)
    rng = random.Random(SEED)

    postflop = []
    for street, board_len in ((1, 3), (2, 4), (3, 5)):
        for _ in range(CASES_PER_STREET):
            deal = rng.sample(range(52), 2 + board_len)
            hole = cards_str(deal[:2])
            board = cards_str(deal[2:])
            bucket = art.assign_bucket(street, hole, board)
            postflop.append({"street": street, "hole": hole, "board": board, "bucket": bucket})

    preflop = []
    for _ in range(60):
        c1, c2 = rng.sample(range(52), 2)
        preflop.append({
            "hole": f"{card_str(c1)} {card_str(c2)}",
            "class": preflop_class(c1, c2),
        })

    out = {
        "buckets": art.buckets,
        "n_buckets": {"flop": len(art.buckets["flop"]) + 1,
                      "turn": len(art.buckets["turn"]) + 1,
                      "river": len(art.buckets["river"]) + 1},
        "postflop": postflop,
        "preflop": preflop,
    }
    with open(out_path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {out_path}: {len(postflop)} postflop, {len(preflop)} preflop cases")
    return 0


if __name__ == "__main__":
    sys.exit(main())

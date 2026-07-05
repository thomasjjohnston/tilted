"""Generate cross-language conformance vectors for the TS solver-engine port.

Emits a JSON file of:
- playouts: seeded random walks through the abstract betting game; at every
  decision the full legal-action list (token + to-amount) is recorded, plus
  the final state. The TS port must reproduce every list and the finals
  byte-for-byte.
- translations: real-hand action sequences (arbitrary bet sizes) with the
  expected abstract seq after action translation.

Run: uv run python -m tilted_solver.genvectors <config.json> <out.json>
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

from .betting import BetState
from .mapper import HandAction, translate_hand

DEPTHS = [10, 25, 60, 100, 150, 200]
PLAYOUTS_PER_DEPTH = 60
TRANSLATIONS_PER_DEPTH = 30
SEED = 20260704


def gen_playouts(config: dict, rng: random.Random) -> list[dict]:
    out = []
    for depth in DEPTHS:
        for _ in range(PLAYOUTS_PER_DEPTH):
            state = BetState(config, depth)
            steps = []
            while state.terminal is None:
                legal = state.legal_actions()
                choice = rng.randrange(len(legal))
                steps.append(
                    {
                        "legal": [{"token": a.token, "to": a.to} for a in legal],
                        "choose": choice,
                        "street": state.street,
                        "pot": state.pot(),
                        "to_act": state.to_act,
                    }
                )
                state.apply(legal[choice])
            out.append(
                {
                    "depth_bb": depth,
                    "steps": steps,
                    "final": {
                        "seq": state.seq_str(),
                        "terminal": state.terminal,
                        "committed": state.committed,
                        "pot": state.pot(),
                        "street": state.street,
                    },
                }
            )
    return out


def gen_translations(config: dict, rng: random.Random) -> list[dict]:
    """Real-ish hands: replay abstract playouts but report actions the way the
    Tilted server records them (kinds + arbitrary to-amounts), perturbing
    aggressive sizes so translation actually has to snap."""
    out = []
    for depth in DEPTHS:
        for _ in range(TRANSLATIONS_PER_DEPTH):
            state = BetState(config, depth)
            real_actions: list[dict] = []
            while state.terminal is None and len(real_actions) < 12:
                legal = state.legal_actions()
                a = legal[rng.randrange(len(legal))]
                player = state.to_act
                if a.token == "f":
                    real_actions.append({"player": player, "kind": "fold"})
                elif a.token == "c":
                    kind = "check" if a.to == state.street_to[player] else "call"
                    real_actions.append({"player": player, "kind": kind})
                elif a.token == "a":
                    real_actions.append({"player": player, "kind": "all_in", "to": a.to})
                else:
                    facing = state.street_to[1 - player] > state.street_to[player]
                    kind = "raise" if facing or state.street == 0 else "bet"
                    # Perturb within ±12% so translation actually has to snap
                    # (gaps between menu sizes are ≥ ~29% geometrically, so the
                    # perturbed amount still snaps to the same action).
                    to = max(1, round(a.to * (1 + rng.uniform(-0.12, 0.12))))
                    real_actions.append({"player": player, "kind": kind, "to": to})
                state.apply(a)
                if state.terminal is not None:
                    real_actions.pop()  # keep the spot mid-hand: drop the closer
                    break
            if not real_actions:
                continue
            try:
                spot = translate_hand(config, depth, [
                    HandAction(r["player"], r["kind"], r.get("to")) for r in real_actions
                ])
            except ValueError:
                continue  # perturbation made an untranslatable line; skip
            out.append(
                {
                    "depth_bb": depth,
                    "real_actions": real_actions,
                    "expect": {
                        "seq": spot.seq,
                        "street": spot.street,
                        "to_act": spot.state.to_act,
                        "pot": spot.state.pot(),
                        "translation": spot.translation,
                    },
                }
            )
    return out


def main() -> int:
    config_path, out_path = sys.argv[1], sys.argv[2]
    config = json.loads(Path(config_path).read_text())
    rng = random.Random(SEED)
    vectors = {
        "generator": "tilted_solver.genvectors",
        "seed": SEED,
        "config": config,
        "playouts": gen_playouts(config, rng),
        "translations": gen_translations(config, rng),
    }
    Path(out_path).write_text(json.dumps(vectors, indent=1))
    print(
        f"wrote {out_path}: {len(vectors['playouts'])} playouts, "
        f"{len(vectors['translations'])} translations"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

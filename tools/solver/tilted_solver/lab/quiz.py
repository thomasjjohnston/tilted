"""Quiz engine: generate scenarios by strategy self-play, grade by EV loss.

Scenarios are found by dealing a concrete hand and letting both seats play
forward sampled from the artifact's average strategy, stopping at a decision
node — so spots arrive with the frequency they occur in engine-vs-engine
play. Sharpness = EV gap between best and worst legal action.
"""

from __future__ import annotations

import json
import random
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..artifact import Artifact
from ..betting import BetState
from ..cards import card_str, cards_str, preflop_class
from ..knapsack import Candidate, solve

BOARD_LEN = {0: 0, 1: 3, 2: 4, 3: 5}


@dataclass
class QuizSpot:
    quiz_id: str
    mode: str  # "single" | "turn"
    depth_bb: int
    # Single-spot fields:
    street: int = 0
    seq: str = ""
    hero_seat: int = 0
    hole: str = ""
    board: str = ""
    pot: int = 0
    to_call: int = 0
    options: list[dict] = field(default_factory=list)  # {token, label, cost}
    # Turn-mode fields:
    hands: list[dict] = field(default_factory=list)
    budget: int = 0
    # Hidden grading payload (kept server-side keyed by quiz_id).
    _answer: dict = field(default_factory=dict)


class QuizEngine:
    def __init__(self, artifact: Artifact, db_path: Path, rng: random.Random | None = None):
        self.artifact = artifact
        self.rng = rng or random.Random()
        self.pending: dict[str, dict] = {}
        # Served from FastAPI's threadpool; guard writes with a lock.
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self._db_lock = threading.Lock()
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS results ("
            " ts REAL, mode TEXT, street INTEGER, depth_bb INTEGER,"
            " ev_loss REAL, blunder INTEGER, details TEXT)"
        )
        self.db.commit()

    # ------------------------------------------------------------------ single

    def next_single(
        self,
        street_filter: int | None = None,
        min_sharpness: float = 0.0,
        max_tries: int = 400,
    ) -> QuizSpot | None:
        """Self-play until we hit a decision node matching the filters."""
        art = self.artifact
        for _ in range(max_tries):
            depth = self.rng.choice(art.depths)
            deal = self.rng.sample(range(52), 9)
            holes = [deal[0:2], deal[2:4]]
            full_board = deal[4:9]
            hero = self.rng.randrange(2)
            state = BetState(art.config, depth)

            while state.terminal is None:
                street = state.street
                board_cards = full_board[: BOARD_LEN[street]]
                actor = state.to_act
                # Stop here? Only at hero nodes, with probability rising by street.
                if actor == hero and self.rng.random() < 0.35 + 0.1 * street:
                    if street_filter is not None and street != street_filter:
                        break
                    spot = self._make_single_spot(
                        depth, state, hero, holes[hero], board_cards, min_sharpness
                    )
                    if spot is not None:
                        return spot
                    break
                row = self._row_for(depth, state, holes[actor], board_cards)
                if row is None:
                    break
                legal = state.legal_actions()
                if [a.token for a in legal] != row.tokens:
                    break
                probs = row.strategy
                choice = self.rng.choices(range(len(legal)), weights=probs)[0]
                state.apply(legal[choice])
        return None

    def _row_for(self, depth: int, state: BetState, hole: list[int], board: list[int]):
        if state.street == 0:
            bucket = preflop_class(hole[0], hole[1])
        else:
            bucket = self.artifact.assign_bucket(
                state.street, cards_str(hole), cards_str(board)
            )
        from ..advisor import _lookup_with_bucket_fallback

        return _lookup_with_bucket_fallback(
            self.artifact, depth, state.street, state.seq_str(), bucket
        )

    def _make_single_spot(
        self, depth, state, hero, hole, board, min_sharpness
    ) -> QuizSpot | None:
        row = self._row_for(depth, state, hole, board)
        if row is None or row.ev is None:
            return None
        legal = state.legal_actions()
        if [a.token for a in legal] != row.tokens:
            return None
        evs = row.ev
        if any(e is None or e != e for e in evs):
            return None
        sharpness = max(evs) - min(evs)
        if sharpness < min_sharpness:
            return None

        from ..advisor import _human_label

        options = []
        for i, act in enumerate(legal):
            options.append(
                {
                    "token": act.token,
                    "label": _human_label(act.token, act.to, state),
                    "cost": max(0, act.to - state.street_to[hero]),
                }
            )
        quiz_id = f"q{self.rng.randrange(1 << 48):012x}"
        me, opp = hero, 1 - hero
        spot = QuizSpot(
            quiz_id=quiz_id,
            mode="single",
            depth_bb=depth,
            street=state.street,
            seq=state.seq_str(),
            hero_seat=hero,
            hole=" ".join(card_str(c) for c in hole),
            board=" ".join(card_str(c) for c in board),
            pot=state.pot(),
            to_call=max(0, state.street_to[opp] - state.street_to[me]),
            options=options,
        )
        self.pending[quiz_id] = {
            "mode": "single",
            "street": state.street,
            "depth_bb": depth,
            "evs": {legal[i].token: evs[i] for i in range(len(legal))},
            "freqs": {legal[i].token: row.strategy[i] for i in range(len(legal))},
            "options": options,
        }
        return spot

    # ------------------------------------------------------------------ turn

    def next_turn(self, n_hands: int = 5, tight_budget: bool = True) -> QuizSpot | None:
        """Full-turn quiz: N fresh SB hands at round start plus a budget."""
        art = self.artifact
        # Use a mid-grid depth for all hands (round start: everyone same depth).
        depth = art.nearest_depth(
            int(self.rng.choice([0.3, 0.5, 1.0]) * max(art.depths) * art.config["blind_big"])
        )
        hands = []
        answer_hands = []
        deals_used: set[int] = set()
        for i in range(n_hands):
            # Independent decks per hand (Tilted rule) — cards may repeat
            # across hands but not within one.
            deal = self.rng.sample(range(52), 2)
            hole = deal
            state = BetState(art.config, depth)
            row = self._row_for(depth, state, hole, [])
            if row is None or row.ev is None or any(e != e for e in row.ev):
                return None
            legal = state.legal_actions()
            if [a.token for a in legal] != row.tokens:
                return None
            from ..advisor import _human_label

            options = [
                {
                    "token": a.token,
                    "label": _human_label(a.token, a.to, state),
                    "cost": max(0, a.to - state.street_to[0]),
                    "ev": row.ev[j],
                }
                for j, a in enumerate(legal)
            ]
            hands.append(
                {
                    "hand_id": f"hand-{i + 1}",
                    "hole": " ".join(card_str(c) for c in hole),
                    "options": [{k: o[k] for k in ("token", "label", "cost")} for o in options],
                }
            )
            answer_hands.append(options)

        stack = depth * art.config["blind_big"]
        budget = (
            self.rng.randrange(stack // 8, stack // 2, 5) if tight_budget else stack
        )
        cand_sets = [
            [
                Candidate(h["hand_id"], o["label"], o["cost"], o["ev"], {"token": o["token"]})
                for o in opts
            ]
            for h, opts in zip(hands, answer_hands)
        ]
        optimal = solve(cand_sets, budget)

        quiz_id = f"q{self.rng.randrange(1 << 48):012x}"
        spot = QuizSpot(
            quiz_id=quiz_id,
            mode="turn",
            depth_bb=depth,
            hands=hands,
            budget=budget,
        )
        self.pending[quiz_id] = {
            "mode": "turn",
            "street": 0,
            "depth_bb": depth,
            "budget": budget,
            "hands": {
                h["hand_id"]: {o["token"]: {"ev": o["ev"], "cost": o["cost"], "label": o["label"]} for o in opts}
                for h, opts in zip(hands, answer_hands)
            },
            "optimal_ev": optimal.total_ev,
            "optimal": {
                hand_id: {"label": c.label, "token": (c.meta or {}).get("token"), "cost": c.cost, "ev": c.ev}
                for hand_id, c in optimal.chosen.items()
            },
        }
        return spot

    # ------------------------------------------------------------------ grade

    def grade(self, quiz_id: str, answer: dict) -> dict | None:
        payload = self.pending.pop(quiz_id, None)
        if payload is None:
            return None
        if payload["mode"] == "single":
            token = answer.get("token")
            evs = payload["evs"]
            if token not in evs:
                return {"error": f"unknown action {token!r}"}
            best_ev = max(evs.values())
            ev_loss = best_ev - evs[token]
            blunder = ev_loss > max(4.0, 0.25 * (max(evs.values()) - min(evs.values())))
            result = {
                "ev_loss": round(ev_loss, 2),
                "blunder": bool(blunder),
                "your_ev": round(evs[token], 2),
                "best_ev": round(best_ev, 2),
                "mix": [
                    {
                        "token": t,
                        "freq": round(payload["freqs"][t], 4),
                        "ev": round(evs[t], 2),
                    }
                    for t in evs
                ],
            }
        else:
            picks: dict = answer.get("picks", {})
            total_ev = 0.0
            total_cost = 0
            per_hand = []
            for hand_id, options in payload["hands"].items():
                token = picks.get(hand_id)
                if token not in options:
                    return {"error": f"missing/unknown pick for {hand_id}"}
                o = options[token]
                total_ev += o["ev"]
                total_cost += o["cost"]
                opt = payload["optimal"][hand_id]
                per_hand.append(
                    {
                        "hand_id": hand_id,
                        "yours": o["label"],
                        "your_ev": round(o["ev"], 2),
                        "optimal": opt["label"],
                        "optimal_ev": round(opt["ev"], 2),
                        "delta": round(opt["ev"] - o["ev"], 2),
                    }
                )
            over_budget = total_cost > payload["budget"]
            ev_loss = payload["optimal_ev"] - total_ev
            result = {
                "ev_loss": round(ev_loss, 2),
                "blunder": bool(ev_loss > 15 or over_budget),
                "your_ev": round(total_ev, 2),
                "your_cost": total_cost,
                "budget": payload["budget"],
                "over_budget": over_budget,
                "optimal_ev": round(payload["optimal_ev"], 2),
                "per_hand": per_hand,
            }

        with self._db_lock:
            self.db.execute(
                "INSERT INTO results (ts, mode, street, depth_bb, ev_loss, blunder, details)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    time.time(),
                    payload["mode"],
                    payload["street"],
                    payload["depth_bb"],
                    result["ev_loss"],
                    int(result["blunder"]),
                    json.dumps(result),
                ),
            )
            self.db.commit()
        return result

    def stats(self) -> dict:
        rows = self.db.execute(
            "SELECT mode, street, COUNT(*), AVG(ev_loss), SUM(blunder) FROM results"
            " GROUP BY mode, street ORDER BY mode, street"
        ).fetchall()
        total = self.db.execute("SELECT COUNT(*), AVG(ev_loss) FROM results").fetchone()
        return {
            "total_answered": total[0] or 0,
            "avg_ev_loss": round(total[1], 2) if total[1] is not None else None,
            "by_bucket": [
                {
                    "mode": m,
                    "street": s,
                    "answered": n,
                    "avg_ev_loss": round(avg, 2),
                    "blunders": bl,
                }
                for m, s, n, avg, bl in rows
            ],
        }

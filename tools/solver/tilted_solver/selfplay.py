"""Self-play evaluation of the coupled game: 10 hands, one shared budget.

Measures what the portfolio (knapsack) layer adds over per-hand play by
simulating full Tilted rounds under the shared-ledger constraint:

- Each round deals 10 independent hands (independent decks, per the spec).
- Turn-based batch play: the player to act chooses an action in every
  pending hand, constrained by sum(new chips) <= available.
- "advisor" allocates jointly via the knapsack; "solo" picks per-hand
  argmax-EV greedily (hand order), falling back to a free action when broke.
- Both agents draw candidates from the same artifact, so the measured gap
  is allocation quality, not strategy quality.
- Duplicate rounds: each deal set is played twice with seats swapped.

Chips are conserved by construction and asserted every round.
"""

from __future__ import annotations

import random
import statistics
from dataclasses import dataclass

from .artifact import Artifact
from .betting import BetState, LegalAction
from .bucket_client import BucketClient
from .cards import cards_str
from .eval7 import eval7
from .knapsack import Candidate, solve

HANDS_PER_ROUND = 10
BOARD_LEN = {0: 0, 1: 3, 2: 4, 3: 5}


@dataclass
class SimHand:
    state: BetState
    holes: list[list[int]]  # [sb_hole, bb_hole]
    board: list[int]

    def showdown_cmp(self) -> int:
        b = self.board
        a7 = self.holes[0] + b
        b7 = self.holes[1] + b
        ra, rb = eval7(a7), eval7(b7)
        return (ra > rb) - (ra < rb)


class Agent:
    """kind: 'advisor' (knapsack) | 'solo' (greedy per-hand argmax)."""

    def __init__(self, kind: str, artifact: Artifact, buckets: BucketClient,
                 shadow_price: float = 1.0, temperature: float = 0.0,
                 rng: random.Random | None = None):
        self.kind = kind
        self.artifact = artifact
        self.buckets = buckets
        self.shadow_price = shadow_price
        self.temperature = temperature
        self.rng = rng or random.Random()

    def act_batch(self, player: int, pending: list[SimHand], available: int) -> list[LegalAction]:
        candidate_sets: list[list[Candidate]] = []
        legal_by_hand: list[list[LegalAction]] = []
        for i, hand in enumerate(pending):
            state = hand.state
            legal = state.legal_actions()
            legal_by_hand.append(legal)
            street = state.street
            board = hand.board[: BOARD_LEN[street]]
            bucket = self.buckets.assign(
                street, cards_str(hand.holes[player]), cards_str(board)
            )
            from .advisor import _lookup_with_bucket_fallback

            row = _lookup_with_bucket_fallback(
                self.artifact, state.depth_bb, street, state.seq_str(), bucket
            )
            cands: list[Candidate] = []
            if row is not None and row.ev is not None and row.tokens == [a.token for a in legal]:
                for j, act in enumerate(legal):
                    ev = row.ev[j]
                    if ev is None or ev != ev:
                        continue
                    cost = max(0, act.to - state.street_to[player])
                    cands.append(Candidate(str(i), f"{act.token}", cost, ev, {"idx": j}))
            if not cands:
                # No data: prefer free continue, else fold.
                j = next(
                    (j for j, a in enumerate(legal)
                     if a.token == "c" and a.to == state.street_to[player]),
                    next(j for j, a in enumerate(legal) if a.token in ("f", "c")),
                )
                cost = max(0, legal[j].to - state.street_to[player]) if legal[j].token != "f" else 0
                cands = [Candidate(str(i), legal[j].token, cost, 0.0, {"idx": j})]
            # Always include a zero-cost escape so the batch stays feasible.
            if all(c.cost > 0 for c in cands):
                j = next(
                    (j for j, a in enumerate(legal)
                     if a.token == "c" and a.to == state.street_to[player]),
                    next(j for j, a in enumerate(legal) if a.token == "f"),
                )
                cands.append(Candidate(str(i), legal[j].token, 0, min(c.ev for c in cands) - 1.0, {"idx": j}))
            candidate_sets.append(cands)

        picks: list[LegalAction] = []
        if self.kind == "advisor":
            alloc = solve(candidate_sets, available, shadow_price=self.shadow_price,
                          temperature=self.temperature, rng=self.rng)
            for i, legal in enumerate(legal_by_hand):
                c = alloc.chosen[str(i)]
                picks.append(legal[(c.meta or {})["idx"]])
        else:
            # Greedy per-hand argmax in hand order under a running budget.
            budget = available
            for cands, legal in zip(candidate_sets, legal_by_hand):
                affordable = [c for c in cands if c.cost <= budget]
                best = max(affordable, key=lambda c: c.ev)
                budget -= best.cost
                picks.append(legal[(best.meta or {})["idx"]])
        return picks


def play_round(
    agents: dict[int, Agent],
    artifact: Artifact,
    totals: list[int],
    deals: list[tuple[list[int], list[int], list[int]]],
    sb_seat: int = 0,
) -> list[int]:
    """Play one full round; returns net chip deltas per seat (sum is 0)."""
    config = artifact.config
    bb = config["blind_big"]
    depth_chips = min(totals)
    depth = artifact.nearest_depth(depth_chips)

    hands: list[SimHand] = []
    for sb_hole, bb_hole, board in deals:
        # BetState player 0 is always the SB; holes[0] is the SB's hand.
        # Seats only decide which agent drives which player index.
        hands.append(SimHand(BetState(config, depth), [sb_hole, bb_hole], board))

    def available(seat: int) -> int:
        p = 0 if seat == sb_seat else 1
        total_committed = sum(h.state.committed[p] for h in hands)
        return totals[seat] - total_committed

    to_move_p = 0  # BetState player index: SB acts first preflop
    for _ in range(200):  # safety bound on turn-cycles
        pending = [h for h in hands if h.state.terminal is None and h.state.to_act == to_move_p]
        if not pending:
            if all(h.state.terminal is not None for h in hands):
                break
            to_move_p = 1 - to_move_p
            continue
        seat = sb_seat if to_move_p == 0 else 1 - sb_seat
        picks = agents[seat].act_batch(to_move_p, pending, available(seat))
        for hand, action in zip(pending, picks):
            hand.state.apply(action)
        to_move_p = 1 - to_move_p
    else:
        raise RuntimeError("round did not terminate within bound")

    # Settle.
    deltas_p = [0, 0]
    for h in hands:
        u0 = h.state.utility_p0(h.showdown_cmp)
        deltas_p[0] += int(u0)
        deltas_p[1] -= int(u0)
    assert deltas_p[0] + deltas_p[1] == 0
    out = [0, 0]
    out[sb_seat] = deltas_p[0]
    out[1 - sb_seat] = deltas_p[1]
    return out


def run_selfplay(
    artifact_path: str,
    rounds: int = 2000,
    seed: int = 1,
    total_chips: int = 400,
    advisor_kwargs: dict | None = None,
    baseline: str = "solo",
) -> int:
    from .artifact import _default_kernel_bin

    artifact = Artifact(artifact_path)
    rng = random.Random(seed)
    buckets = BucketClient(_default_kernel_bin(), artifact.buckets_file())
    advisor = Agent("advisor", artifact, buckets,
                    rng=random.Random(seed + 1), **(advisor_kwargs or {}))
    base = Agent("solo", artifact, buckets, rng=random.Random(seed + 2))

    results: list[float] = []
    try:
        for r in range(rounds):
            # Independent decks per hand (Tilted rule).
            deals = []
            for _ in range(HANDS_PER_ROUND):
                deck = rng.sample(range(52), 9)
                deals.append((deck[0:2], deck[2:4], deck[4:9]))
            sb = r % 2
            # Duplicate: same deals, seats swapped.
            d1 = play_round({0: advisor, 1: base}, artifact, [total_chips, total_chips], deals, sb_seat=sb)
            d2 = play_round({0: base, 1: advisor}, artifact, [total_chips, total_chips], deals, sb_seat=sb)
            results.append((d1[0] - d2[0]) / 2.0)  # advisor edge on this deal set
            if (r + 1) % 200 == 0:
                mean = statistics.mean(results)
                se = statistics.stdev(results) / (len(results) ** 0.5) if len(results) > 1 else 0
                print(f"[{r + 1}/{rounds}] advisor edge: {mean:+.2f} ± {se:.2f} chips/round")
    finally:
        buckets.close()

    mean = statistics.mean(results)
    se = statistics.stdev(results) / (len(results) ** 0.5) if len(results) > 1 else 0.0
    bb = artifact.config["blind_big"]
    print(
        f"\nadvisor vs {baseline}: {mean:+.2f} ± {se:.2f} chips/round "
        f"({mean / bb:+.2f} bb/round) over {rounds} duplicate deal sets "
        f"at {total_chips} total chips"
    )
    return 0

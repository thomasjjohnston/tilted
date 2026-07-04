"""The recommendation engine: viewer round state in, recommended cart out.

Input round-state JSON (everything here is information the viewer legitimately
has in Tilted — own hole cards, public boards/actions, both players' chip
counts; never the opponent's holes):

{
  "viewer_is_sb": true,
  "my_available": 1450,
  "opp_available": 1520,
  "hands": [
    {
      "hand_id": "h3",
      "my_hole": "Ah Kd",
      "board": "2c 7h Ts",           // "" preflop
      "my_reserved": 25,              // viewer chips already in THIS hand
      "opp_reserved": 25,
      "pending": true,                // action on the viewer?
      "actions": [                    // full action history, both players
        {"player": 0, "kind": "raise", "to": 25},
        {"player": 1, "kind": "call"}
      ]
    }, ...
  ]
}
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from .artifact import Artifact, InfosetRow
from .betting import TOK_ALLIN, TOK_CALL, TOK_FOLD
from .knapsack import Allocation, Candidate, marginal_chip_value, solve
from .mapper import HandAction, translate_hand

MAX_CANDIDATES = 5


@dataclass
class HandAdvice:
    hand_id: str
    depth_bb: int
    street: int
    seq: str
    bucket: int
    ok: bool  # False when the artifact had no data for this spot
    note: str = ""
    # Full strategy mix at this infoset: [{token, label, cost, ev, freq}]
    mix: list[dict] = field(default_factory=list)
    solo_token: str = ""  # what single-hand GTO would pick (max frequency)
    recommended_token: str = ""  # what the budget-aware cart picks
    recommended_label: str = ""


@dataclass
class CartAdvice:
    hands: list[HandAdvice]
    budget: int
    total_cost: int
    total_ev: float
    marginal_chip_value: float
    notes: list[str] = field(default_factory=list)


def _human_label(token: str, to: int, state) -> str:
    me = state.to_act
    street_to = state.street_to[me]
    opp_to = state.street_to[1 - me]
    if token == TOK_FOLD:
        return "fold"
    if token == TOK_CALL:
        if to == street_to:
            return "check"
        return f"call {to - street_to}"
    if token == TOK_ALLIN:
        return f"all-in ({to - street_to} more)"
    if opp_to > street_to:
        return f"raise to {to}"
    return f"bet {to}"


def advise(
    artifact: Artifact,
    round_state: dict,
    shadow_price: float = 1.0,
    temperature: float = 0.0,
    seed: int | None = None,
) -> CartAdvice:
    viewer_seat = 0 if round_state["viewer_is_sb"] else 1
    my_available = int(round_state["my_available"])
    opp_available = int(round_state["opp_available"])
    bb = artifact.config["blind_big"]
    notes: list[str] = []

    hand_advices: list[HandAdvice] = []
    candidate_sets: list[list[Candidate]] = []

    for hand in round_state["hands"]:
        if not hand.get("pending", True):
            continue
        hand_id = str(hand["hand_id"])
        my_reserved = int(hand.get("my_reserved", 0))
        opp_reserved = int(hand.get("opp_reserved", 0))

        # Effective stack for this hand (spec §7: available + reserved-in-hand).
        eff = min(my_available + my_reserved, opp_available + opp_reserved)
        depth = artifact.nearest_depth(eff)

        actions = [
            HandAction(player=int(a["player"]), kind=a["kind"], to=a.get("to"))
            for a in hand.get("actions", [])
        ]
        try:
            spot = translate_hand(artifact.config, depth, actions)
        except ValueError as e:
            hand_advices.append(
                HandAdvice(hand_id, depth, 0, "", 0, ok=False, note=f"untranslatable: {e}")
            )
            candidate_sets.append([Candidate(hand_id, "check/fold", 0, 0.0)])
            continue

        state = spot.state
        if state.terminal is not None or state.to_act != viewer_seat:
            hand_advices.append(
                HandAdvice(hand_id, depth, state.street, spot.seq, 0, ok=False,
                           note="not viewer's turn in abstract replay")
            )
            candidate_sets.append([Candidate(hand_id, "check/fold", 0, 0.0)])
            continue

        bucket = artifact.assign_bucket(state.street, hand["my_hole"], hand.get("board", ""))
        row = _lookup_with_bucket_fallback(artifact, depth, state.street, spot.seq, bucket)

        legal = state.legal_actions()
        advice = HandAdvice(hand_id, depth, state.street, spot.seq, bucket, ok=row is not None)
        if row is None:
            advice.note = "no artifact data for this spot (rare line or undertrained)"
            # Degenerate but safe: check when free, otherwise fold.
            check = next((a for a in legal if a.token == TOK_CALL and a.to == state.street_to[viewer_seat]), None)
            fallback = check or next(a for a in legal if a.token in (TOK_FOLD, TOK_CALL))
            label = _human_label(fallback.token, fallback.to, state)
            advice.mix = [{"token": fallback.token, "label": label, "cost": max(0, fallback.to - state.street_to[viewer_seat]), "ev": 0.0, "freq": 1.0}]
            advice.solo_token = fallback.token
            hand_advices.append(advice)
            candidate_sets.append([Candidate(hand_id, label, 0, 0.0, {"token": fallback.token})])
            continue

        if row.bucket != bucket:
            advice.note = f"nearest-bucket fallback ({bucket} -> {row.bucket})"

        # Build the mix, aligning artifact rows with the replayed legal actions.
        mix = []
        for i, tok in enumerate(row.tokens):
            act = next((a for a in legal if a.token == tok), None)
            if act is None:
                continue
            cost = max(0, act.to - state.street_to[viewer_seat])
            ev = None
            if row.ev is not None and i < len(row.ev):
                v = row.ev[i]
                ev = None if v is None or v != v else v  # filter NaN
            mix.append(
                {"token": tok, "label": _human_label(tok, act.to, state),
                 "cost": cost, "ev": ev, "freq": row.strategy[i]}
            )
        if not mix:
            advice.ok = False
            advice.note = "artifact row incompatible with replayed legal actions"
            hand_advices.append(advice)
            candidate_sets.append([Candidate(hand_id, "check/fold", 0, 0.0)])
            continue

        advice.mix = mix
        advice.solo_token = max(mix, key=lambda m: m["freq"])["token"]

        has_evs = all(m["ev"] is not None for m in mix)
        if has_evs:
            ranked = sorted(mix, key=lambda m: m["ev"], reverse=True)[:MAX_CANDIDATES]
            cands = [
                Candidate(hand_id, m["label"], m["cost"], m["ev"], {"token": m["token"]})
                for m in ranked
            ]
            # Guarantee a zero-cost option so the knapsack always has a
            # feasible assignment (fold or check is always legal).
            if all(c.cost > 0 for c in cands):
                free = min((m for m in mix if m["cost"] == 0), key=lambda m: -m["freq"], default=None)
                if free is not None:
                    cands.append(Candidate(hand_id, free["label"], 0, free["ev"], {"token": free["token"]}))
        else:
            # Frequency mode: no EVs in the artifact for this row; fall back to
            # the highest-frequency action with zero portfolio interaction.
            advice.note = (advice.note + "; " if advice.note else "") + "frequency mode (no EVs)"
            best = max(mix, key=lambda m: m["freq"])
            cands = [Candidate(hand_id, best["label"], best["cost"], 0.0, {"token": best["token"]})]
            free = min((m for m in mix if m["cost"] == 0), key=lambda m: -m["freq"], default=None)
            if free is not None and free["token"] != best["token"]:
                cands.append(Candidate(hand_id, free["label"], 0, 0.0, {"token": free["token"]}))

        hand_advices.append(advice)
        candidate_sets.append(cands)

    # Portfolio layer: the budget is the viewer's available chips.
    rng = random.Random(seed)
    allocation: Allocation = solve(
        candidate_sets, my_available, shadow_price=shadow_price,
        temperature=temperature, rng=rng,
    )
    mcv = marginal_chip_value(candidate_sets, my_available)

    for advice in hand_advices:
        chosen = allocation.chosen.get(advice.hand_id)
        if chosen is None:
            continue
        advice.recommended_token = (chosen.meta or {}).get("token", "")
        advice.recommended_label = chosen.label
        if advice.recommended_token != advice.solo_token and advice.ok:
            advice.note = (advice.note + "; " if advice.note else "") + (
                "budget-adjusted: solo GTO prefers a different action"
            )

    if mcv > 0:
        notes.append(
            f"budget is binding: each extra chip of budget is worth ~{mcv:.2f} chips of EV"
        )

    return CartAdvice(
        hands=hand_advices,
        budget=my_available,
        total_cost=allocation.total_cost,
        total_ev=allocation.total_ev,
        marginal_chip_value=mcv,
        notes=notes,
    )


def _lookup_with_bucket_fallback(
    artifact: Artifact, depth: int, street: int, seq: str, bucket: int
) -> InfosetRow | None:
    row = artifact.lookup(depth, street, seq, bucket)
    if row is not None:
        return row
    rows = artifact.lookup_all_buckets(depth, street, seq)
    if not rows:
        return None
    return min(rows, key=lambda r: abs(r.bucket - bucket))


def advice_to_dict(cart: CartAdvice) -> dict:
    return {
        "budget": cart.budget,
        "total_cost": cart.total_cost,
        "total_ev": round(cart.total_ev, 2),
        "marginal_chip_value": round(cart.marginal_chip_value, 4),
        "notes": cart.notes,
        "hands": [
            {
                "hand_id": h.hand_id,
                "depth_bb": h.depth_bb,
                "street": h.street,
                "seq": h.seq,
                "bucket": h.bucket,
                "ok": h.ok,
                "note": h.note,
                "recommended": h.recommended_label,
                "recommended_token": h.recommended_token,
                "solo_token": h.solo_token,
                "mix": [
                    {**m, "ev": (round(m["ev"], 2) if m["ev"] is not None else None),
                     "freq": round(m["freq"], 4)}
                    for m in h.mix
                ],
            }
            for h in cart.hands
        ],
    }

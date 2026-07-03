"""Spot mapper: translate a real Tilted hand state into an artifact lookup.

Real states have arbitrary bet sizes; the artifact has a small menu. Action
translation maps each observed aggressive action onto the nearest menu action
(geometric distance in "to" space), replaying the abstract state alongside so
every subsequent size is interpreted in the right context.
"""

from __future__ import annotations

from dataclasses import dataclass

from .betting import BetState, LegalAction, TOK_ALLIN, TOK_CALL, TOK_FOLD


@dataclass
class HandAction:
    """One observed action in a real hand, viewer-agnostic."""

    player: int  # 0 = SB/BTN, 1 = BB
    kind: str  # "fold" | "check" | "call" | "bet" | "raise" | "all_in"
    to: int | None = None  # street bet-to amount for bet/raise/all_in


@dataclass
class MappedSpot:
    depth_bb: int
    street: int
    seq: str
    state: BetState
    # For each real observed action, the abstract token chosen (diagnostics).
    translation: list[str]


def geometric_distance(a: int, b: int) -> float:
    """Distance in log space; robust to scale, standard for action translation."""
    import math

    if a <= 0 or b <= 0:
        return float("inf")
    return abs(math.log(a) - math.log(b))


def translate_hand(
    config: dict,
    depth_bb: int,
    actions: list[HandAction],
) -> MappedSpot:
    """Replay observed actions through the abstract game, snapping each
    aggressive action to the nearest legal menu size."""
    state = BetState(config, depth_bb)
    translation: list[str] = []

    for act in actions:
        if state.terminal is not None:
            raise ValueError("real hand continues past abstract terminal")
        if act.player != state.to_act:
            raise ValueError(
                f"action order mismatch: real {act.player} vs abstract {state.to_act}"
            )
        legal = state.legal_actions()
        chosen = _translate_action(act, legal)
        translation.append(chosen.token)
        state.apply(chosen)

    return MappedSpot(
        depth_bb=depth_bb,
        street=state.street,
        seq=state.seq_str(),
        state=state,
        translation=translation,
    )


def _translate_action(act: HandAction, legal: list[LegalAction]) -> LegalAction:
    by_token = {a.token: a for a in legal}
    if act.kind == "fold":
        return by_token[TOK_FOLD]
    if act.kind in ("check", "call"):
        return by_token[TOK_CALL]
    if act.kind == "all_in":
        if TOK_ALLIN in by_token:
            return by_token[TOK_ALLIN]
        # The abstract state can't raise (e.g. facing all-in): treat as call.
        return by_token[TOK_CALL]
    # bet / raise: snap to nearest aggressive action by geometric distance.
    assert act.to is not None, f"{act.kind} requires a to amount"
    aggressive = [a for a in legal if a.token not in (TOK_FOLD, TOK_CALL)]
    if not aggressive:
        return by_token[TOK_CALL]
    return min(aggressive, key=lambda a: geometric_distance(a.to, act.to))


def effective_stack(
    total_a: int, reserved_other_a: int, total_b: int, reserved_other_b: int
) -> int:
    """Effective stack for one Tilted hand: each player's ceiling is what they
    can still put into THIS hand (available + already in this hand). The
    effective stack is the smaller ceiling.

    reserved_other_* = chips reserved in OTHER active hands (unavailable here).
    """
    ceil_a = total_a - reserved_other_a
    ceil_b = total_b - reserved_other_b
    return max(0, min(ceil_a, ceil_b))

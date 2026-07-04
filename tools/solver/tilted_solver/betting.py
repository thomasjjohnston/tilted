"""Betting state machine: a faithful Python port of kernel/src/nlhe.rs.

Every rule here must match the Rust implementation exactly — the advisor
replays artifact sequences with this code, and conformance tests
(tests/test_conformance.py) pin the two implementations together.

Token scheme: "f" fold, "c" check/call, "r<N>" menu raise N, "a" all-in,
"/" street separator.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

STREETS = ["preflop", "flop", "turn", "river"]


def _round_half_up(x: float) -> int:
    """Match Rust's f64::round (half away from zero; our sizes are positive).

    Python's built-in round() is banker's rounding and MUST NOT be used for
    bet sizing — it diverges from the kernel on exact .5 values.
    """
    import math

    return math.floor(x + 0.5)
TOK_FOLD = "f"
TOK_CALL = "c"
TOK_ALLIN = "a"
TOK_STREET = "/"
MAX_TOKENS = 32


@dataclass(frozen=True)
class LegalAction:
    token: str
    to: int  # street "bet to" amount after the action (0 for fold)


@dataclass
class BetState:
    config: dict
    depth_bb: int
    # Optional exact stack in chips (e.g. match play at 1,735 chips); when
    # None, the stack is depth_bb * BB. depth_bb still drives menu gating
    # (overbet thresholds), so pass the effective depth alongside.
    stack_chips: int | None = None
    stack: int = 0
    street: int = 0
    committed: list[int] = field(default_factory=list)
    street_to: list[int] = field(default_factory=list)
    last_raise: int = 0
    raises_this_street: int = 0
    acted: list[bool] = field(default_factory=lambda: [False, False])
    to_act: int = 0
    terminal: Optional[str] = None  # None | "fold0" | "fold1" | "showdown"
    seq: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        bb = self.config["blind_big"]
        sb = self.config["blind_small"]
        self.stack = self.stack_chips if self.stack_chips is not None else self.depth_bb * bb
        self.committed = [sb, bb]
        self.street_to = [sb, bb]
        self.last_raise = bb - sb

    # -- helpers -----------------------------------------------------------

    def pot(self) -> int:
        return self.committed[0] + self.committed[1]

    def is_all_in(self, p: int) -> bool:
        return self.committed[p] >= self.stack

    def allin_to(self) -> int:
        me = self.to_act
        return self.stack - (self.committed[me] - self.street_to[me])

    # -- menu (mirrors nlhe.rs `menu`) --------------------------------------

    def _menu(self) -> list[tuple[int, int]]:
        m = self.config["bet_menus"]
        me, opp = self.to_act, 1 - self.to_act
        facing = self.street_to[opp] > self.street_to[me]
        opp_to = self.street_to[opp]
        pot0 = self.pot()
        call_amount = max(0, opp_to - self.street_to[me])
        pot_if_call = pot0 + call_amount
        bb = self.config["blind_big"]
        street_name = STREETS[self.street]

        if self.street == 0:
            if self.raises_this_street == 0:
                sizes = list(m["preflop_opens"])
            else:
                sizes = list(m["preflop_raises"])
        else:
            sizes = list(m[street_name])
            if (
                self.depth_bb >= m["overbet_min_depth_bb"]
                and street_name in m["overbet_streets"]
            ):
                sizes.extend(m["overbet"])

        out: list[tuple[int, int]] = []
        allin_to = self.allin_to()
        for i, size in enumerate(sizes):
            if self.street == 0:
                if self.raises_this_street == 0:
                    raw_to = _round_half_up(size * bb)
                else:
                    raw_to = _round_half_up(size * opp_to)
            elif not facing:
                raw_to = _round_half_up(size * pot0)
            else:
                raw_to = opp_to + _round_half_up(size * pot_if_call)
            to = ((raw_to + 2) // 5) * 5
            if facing or self.street == 0:
                min_to = opp_to + max(self.last_raise, bb)
            else:
                min_to = bb
            to = max(to, min_to)
            if to >= (1.0 - m["near_allin_prune"]) * allin_to:
                continue
            out.append((i, to))
        # Dedup identical amounts, keeping the first.
        seen: set[int] = set()
        deduped = []
        for i, to in out:
            if to not in seen:
                seen.add(to)
                deduped.append((i, to))
        return deduped

    # -- legal actions (mirrors nlhe.rs `legal_actions`) ---------------------

    def legal_actions(self) -> list[LegalAction]:
        assert self.terminal is None, "no actions at a terminal state"
        me, opp = self.to_act, 1 - self.to_act
        facing = self.street_to[opp] > self.street_to[me]
        out: list[LegalAction] = []

        if facing:
            out.append(LegalAction(TOK_FOLD, 0))
        call_to = min(self.street_to[opp], self.allin_to())
        out.append(LegalAction(TOK_CALL, call_to))

        opp_all_in = self.committed[opp] >= self.stack
        if not opp_all_in and len(self.seq) < MAX_TOKENS - 2:
            if self.raises_this_street < self.config["bet_menus"]["raise_cap"]:
                for i, to in self._menu():
                    if self.street_to[opp] < to < self.allin_to():
                        out.append(LegalAction(f"r{i}", to))
            allin = self.allin_to()
            if allin > self.street_to[opp]:
                out.append(LegalAction(TOK_ALLIN, allin))
        return out

    # -- apply (mirrors nlhe.rs `apply`) -------------------------------------

    def apply(self, action: LegalAction) -> None:
        me, opp = self.to_act, 1 - self.to_act
        self.seq.append(action.token)

        if action.token == TOK_FOLD:
            self.terminal = f"fold{me}"
            return

        if action.token == TOK_CALL:
            delta = action.to - self.street_to[me]
            self.street_to[me] = action.to
            self.committed[me] += delta
            self.acted[me] = True
        else:
            delta = action.to - self.street_to[me]
            increment = max(0, action.to - self.street_to[opp])
            self.street_to[me] = action.to
            self.committed[me] += delta
            self.acted[me] = True
            if increment > self.last_raise:
                self.last_raise = increment
            self.raises_this_street += 1

        matched = (
            self.street_to[me] == self.street_to[opp]
            or self.is_all_in(me)
            or self.is_all_in(opp)
        )
        closing = action.token == TOK_CALL
        if closing and self.acted[me] and self.acted[opp] and matched:
            someone_all_in = self.is_all_in(0) or self.is_all_in(1)
            if self.street == 3 or someone_all_in:
                self.terminal = "showdown"
            else:
                self.street += 1
                self.street_to = [0, 0]
                self.last_raise = 0
                self.raises_this_street = 0
                self.acted = [False, False]
                self.to_act = 1  # BB acts first postflop
                self.seq.append(TOK_STREET)
            return
        self.to_act = opp

    def seq_str(self) -> str:
        return "".join(self.seq)

    def utility_p0(self, showdown_cmp) -> float:
        """Net utility for player 0 at a terminal state (mirrors nlhe.rs).

        showdown_cmp: callable returning >0 if player 0's hand wins, 0 tie.
        """
        assert self.terminal is not None, "utility at non-terminal"
        pot_each = float(min(self.committed[0], self.committed[1]))
        if self.terminal == "fold0":
            return -pot_each
        if self.terminal == "fold1":
            return pot_each
        cmp = showdown_cmp()
        return pot_each if cmp > 0 else (-pot_each if cmp < 0 else 0.0)


def tokenize_seq(seq: str) -> list[str]:
    """Split a seq string like 'r0c/cr1c/' into tokens."""
    out: list[str] = []
    i = 0
    while i < len(seq):
        ch = seq[i]
        if ch in ("f", "c", "a", "/"):
            out.append(ch)
            i += 1
        elif ch == "r":
            j = i + 1
            while j < len(seq) and seq[j].isdigit():
                j += 1
            out.append(seq[i:j])
            i = j
        else:
            raise ValueError(f"bad token char {ch!r} in {seq!r}")
    return out


def replay(config: dict, depth_bb: int, tokens: list[str]) -> BetState:
    """Replay non-separator tokens from the root, validating separators."""
    state = BetState(config, depth_bb)
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok == TOK_STREET:
            raise ValueError(f"unexpected street separator at {i} in {tokens}")
        if state.terminal is not None:
            raise ValueError("actions after terminal state")
        legal = {a.token: a for a in state.legal_actions()}
        if tok not in legal:
            raise ValueError(f"illegal token {tok!r} at {i}; legal: {sorted(legal)}")
        state.apply(legal[tok])
        i += 1
        if len(state.seq) > i and state.seq[i] == TOK_STREET:
            if i >= len(tokens) or tokens[i] != TOK_STREET:
                # The input may legitimately end exactly before a separator.
                if i >= len(tokens):
                    break
                raise ValueError(f"expected street separator at {i} in {tokens}")
            i += 1
    return state

"""Play heads-up against the solver: single abstract-game hands.

The human and the bot both act in the trained abstract game (menu bet sizes),
so the bot is always on-policy. The bot samples from the artifact's average
strategy — mixed strategies played as mixtures, the way GTO is meant to run.

Server-side state per game id; the view sent to the client never contains the
bot's hole cards until the hand is over (same redaction discipline as Tilted).
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from ..advisor import _human_label, _lookup_with_bucket_fallback
from ..artifact import Artifact
from ..betting import BetState
from ..cards import card_str, cards_str, preflop_class
from ..eval7 import eval7

BOARD_LEN = {0: 0, 1: 3, 2: 4, 3: 5}
STREET_NAMES = ["preflop", "flop", "turn", "river"]


@dataclass
class PlaySession:
    depth_bb: int  # effective depth of the CURRENT hand (display / menu gating)
    # Match state: stacks persist hand to hand; bust ends the match.
    human_stack: int = 0
    bot_stack: int = 0
    match_over: bool = False
    matches_human: int = 0
    matches_bot: int = 0
    hands_played: int = 0
    human_net: int = 0
    # Per-hand state:
    state: BetState | None = None
    holes: list[list[int]] = field(default_factory=list)  # [sb, bb] player-indexed
    board: list[int] = field(default_factory=list)
    human_player: int = 0  # BetState player index (0 = SB) for this hand
    lookup_depth: int = 0  # artifact depth used for the bot's strategy
    log: list[str] = field(default_factory=list)
    result: str | None = None
    hand_net: int = 0


class PlayEngine:
    # A match ends when the loser can no longer post the big blind.
    BUST_THRESHOLD_BB = 2

    def __init__(self, artifact: Artifact, start_depth_bb: int = 200, seed: int | None = None):
        self.artifact = artifact
        self.rng = random.Random(seed)
        self.sessions: dict[str, PlaySession] = {}
        self.start_chips = start_depth_bb * artifact.config["blind_big"]

    # ------------------------------------------------------------------ api

    def new_session(self) -> str:
        sid = f"g{self.rng.randrange(1 << 48):012x}"
        self.sessions[sid] = PlaySession(
            depth_bb=0, human_stack=self.start_chips, bot_stack=self.start_chips
        )
        self._deal(self.sessions[sid])
        return sid

    def next_hand(self, sid: str) -> None:
        s = self._get(sid)
        if s.state is not None and s.state.terminal is None:
            raise ValueError("hand still in progress")
        if s.match_over:
            # Fresh match: reset stacks, keep the lifetime score and tallies.
            s.human_stack = self.start_chips
            s.bot_stack = self.start_chips
            s.match_over = False
            s.log.append("— new match: stacks reset —")
        self._deal(s)

    def act(self, sid: str, token: str) -> None:
        s = self._get(sid)
        state = s.state
        if state is None or state.terminal is not None:
            raise ValueError("no hand in progress")
        if state.to_act != s.human_player:
            raise ValueError("not your turn")
        legal = {a.token: a for a in state.legal_actions()}
        if token not in legal:
            raise ValueError(f"illegal action {token!r}; legal: {sorted(legal)}")
        self._log_action(s, "you", legal[token])
        state.apply(legal[token])
        self._advance_bot(s)
        self._maybe_settle(s)

    def view(self, sid: str) -> dict:
        s = self._get(sid)
        state = s.state
        assert state is not None
        terminal = state.terminal is not None
        human = s.human_player
        # Board shown: current street's cards (full board once a showdown
        # settles, including all-in runouts).
        show_all = terminal and state.terminal == "showdown"
        board_n = 5 if show_all else BOARD_LEN[state.street]
        legal = [] if terminal or state.to_act != human else state.legal_actions()
        # Behind-stacks: match stacks are debited at settlement, so mid-hand
        # we subtract live commitments; post-hand the settled stack is it.
        behind_you = s.human_stack if terminal else s.human_stack - state.committed[human]
        behind_bot = s.bot_stack if terminal else s.bot_stack - state.committed[1 - human]
        return {
            "depth_bb": s.depth_bb,
            "you_are": "SB (button)" if human == 0 else "BB",
            "your_hole": cards_str(s.holes[human]),
            "bot_hole": cards_str(s.holes[1 - human]) if terminal and show_all else None,
            "board": cards_str(s.board[:board_n]),
            "street": STREET_NAMES[state.street],
            "pot": state.pot(),
            "your_committed": state.committed[human],
            "bot_committed": state.committed[1 - human],
            "stack": state.stack,
            "your_stack": behind_you,
            "bot_stack": behind_bot,
            "match_over": s.match_over,
            "to_call": max(0, state.street_to[1 - human] - state.street_to[human]),
            "your_turn": not terminal and state.to_act == human,
            "terminal": terminal,
            "result": s.result,
            "hand_net": s.hand_net if terminal else 0,
            "log": s.log,
            "score": {"hands": s.hands_played, "net": s.human_net,
                      "bb_per_hand": round(s.human_net / 10 / max(1, s.hands_played), 2),
                      "matches_you": s.matches_human, "matches_solver": s.matches_bot},
            "actions": [
                {"token": a.token, "label": _human_label(a.token, a.to, state),
                 "cost": max(0, a.to - state.street_to[human])}
                for a in legal
            ],
        }

    # ------------------------------------------------------------------ internals

    def _get(self, sid: str) -> PlaySession:
        if sid not in self.sessions:
            raise KeyError("unknown game id")
        return self.sessions[sid]

    def _deal(self, s: PlaySession) -> None:
        bb = self.artifact.config["blind_big"]
        # The hand plays for the effective stack: the shorter of the two.
        effective = min(s.human_stack, s.bot_stack)
        depth_bb = max(2, effective // bb)
        s.depth_bb = depth_bb
        s.lookup_depth = self.artifact.nearest_depth(effective)

        deal = self.rng.sample(range(52), 9)
        s.holes = [deal[0:2], deal[2:4]]
        s.board = deal[4:9]
        s.state = BetState(self.artifact.config, depth_bb, stack_chips=effective)
        # Alternate position each hand: human is SB on even hands.
        s.human_player = s.hands_played % 2
        s.log = s.log[-6:] if s.log else []  # keep a little cross-hand context
        s.log.append(
            f"— hand {s.hands_played + 1}: you are {'SB' if s.human_player == 0 else 'BB'}"
            f" · effective {effective} ({depth_bb}bb) —"
        )
        s.result = None
        s.hand_net = 0
        self._advance_bot(s)
        self._maybe_settle(s)

    def _advance_bot(self, s: PlaySession) -> None:
        state = s.state
        assert state is not None
        bot = 1 - s.human_player
        prev_street = state.street
        while state.terminal is None and state.to_act == bot:
            action = self._bot_action(s)
            self._log_action(s, "solver", action)
            state.apply(action)
            if state.street != prev_street and state.terminal is None:
                self._log_street(s)
                prev_street = state.street
        if state.terminal is None and state.street != prev_street:
            self._log_street(s)

    def _bot_action(self, s: PlaySession):
        state = s.state
        assert state is not None
        bot = 1 - s.human_player
        legal = state.legal_actions()
        street = state.street
        board = s.board[: BOARD_LEN[street]]
        if street == 0:
            bucket = preflop_class(s.holes[bot][0], s.holes[bot][1])
        else:
            bucket = self.artifact.assign_bucket(
                street, cards_str(s.holes[bot]), cards_str(board)
            )
        row = _lookup_with_bucket_fallback(
            self.artifact, s.lookup_depth, street, state.seq_str(), bucket
        )
        if row is not None:
            # Live hands play at exact chip stacks; the artifact was trained at
            # grid depths, so menus can differ at the margins (near-all-in
            # pruning). Sample over the shared tokens, renormalized.
            weight_by_token = dict(zip(row.tokens, row.strategy))
            shared = [(a, weight_by_token[a.token]) for a in legal if a.token in weight_by_token]
            total = sum(w for _, w in shared)
            if shared and total > 1e-9:
                r = self.rng.random() * total
                for action, w in shared:
                    r -= w
                    if r <= 0:
                        return action
                return shared[-1][0]
        # Off-book (line the blueprint never reached): check when free,
        # otherwise call. Honest fallback, logged for transparency.
        s.log.append("(solver off-book: defaulting to passive line)")
        free = next((a for a in legal if a.token == "c"), legal[0])
        return free

    def _log_action(self, s: PlaySession, who: str, action) -> None:
        state = s.state
        assert state is not None
        s.log.append(f"{who}: {_human_label(action.token, action.to, state)}")

    def _log_street(self, s: PlaySession) -> None:
        state = s.state
        assert state is not None
        n = BOARD_LEN[state.street]
        s.log.append(
            f"— {STREET_NAMES[state.street]}: "
            f"{' '.join(card_str(c) for c in s.board[:n])} (pot {state.pot()}) —"
        )

    def _maybe_settle(self, s: PlaySession) -> None:
        state = s.state
        assert state is not None
        if state.terminal is None:
            return
        human = s.human_player

        def showdown_cmp() -> int:
            a7 = s.holes[0] + s.board
            b7 = s.holes[1] + s.board
            ra, rb = eval7(a7), eval7(b7)
            return (ra > rb) - (ra < rb)

        u0 = state.utility_p0(showdown_cmp)
        net = int(u0 if human == 0 else -u0)
        s.hand_net = net
        s.human_net += net
        s.human_stack += net
        s.bot_stack -= net
        s.hands_played += 1
        if state.terminal == "showdown":
            bot_cards = cards_str(s.holes[1 - human])
            outcome = "you win" if net > 0 else ("split pot" if net == 0 else "solver wins")
            s.result = f"showdown — solver shows {bot_cards} — {outcome} ({net:+d})"
        elif (state.terminal == "fold0") == (human == 0):
            s.result = f"you folded ({net:+d})"
        else:
            s.result = f"solver folds — you win ({net:+d})"
        s.log.append(s.result)

        # Bust check: match ends when a stack can't meaningfully continue.
        bust_line = self.BUST_THRESHOLD_BB * self.artifact.config["blind_big"]
        if min(s.human_stack, s.bot_stack) < bust_line:
            s.match_over = True
            if s.human_stack > s.bot_stack:
                s.matches_human += 1
                s.result += " — solver is busto, you win the match!"
            else:
                s.matches_bot += 1
                s.result += " — you're busto, solver wins the match."
            s.log.append(s.result.split(" — ")[-1])

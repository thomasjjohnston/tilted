"""Python betting engine tests — mirrors kernel/src/nlhe.rs unit tests."""

import random

from tilted_solver.betting import BetState, MAX_TOKENS


def test_preflop_open_and_call_advances_to_flop(default_config):
    s = BetState(default_config, 100)
    open_ = next(a for a in s.legal_actions() if a.token == "r0")
    assert open_.to == 25
    s.apply(open_)
    assert s.to_act == 1
    call = next(a for a in s.legal_actions() if a.token == "c")
    s.apply(call)
    assert s.street == 1
    assert s.to_act == 1  # BB first postflop
    assert s.pot() == 50
    assert s.committed == [25, 25]
    assert s.seq[-1] == "/"


def test_limp_gives_bb_option(default_config):
    s = BetState(default_config, 100)
    call = next(a for a in s.legal_actions() if a.token == "c")
    assert call.to == 10
    s.apply(call)
    assert s.street == 0
    assert s.to_act == 1
    acts = s.legal_actions()
    assert not any(a.token == "f" for a in acts), "BB not facing a bet"
    s.apply(next(a for a in acts if a.token == "c"))
    assert s.street == 1
    assert s.pot() == 20


def test_fold_terminal(default_config):
    s = BetState(default_config, 100)
    s.apply(next(a for a in s.legal_actions() if a.token == "f"))
    assert s.terminal == "fold0"


def test_allin_call_showdown(default_config):
    s = BetState(default_config, 25)
    jam = next(a for a in s.legal_actions() if a.token == "a")
    assert jam.to == 250
    s.apply(jam)
    acts = s.legal_actions()
    assert len(acts) == 2, f"facing jam: fold or call only, got {acts}"
    s.apply(next(a for a in acts if a.token == "c"))
    assert s.terminal == "showdown"
    assert s.committed == [250, 250]


def test_min_raise_rule(default_config):
    s = BetState(default_config, 100)
    s.apply(next(a for a in s.legal_actions() if a.token == "r0"))  # open to 25
    for a in s.legal_actions():
        if a.token.startswith("r"):
            assert a.to >= 40, f"raise to {a.to} violates min-raise"


def test_overbet_gating(default_config):
    def reach_turn(depth):
        s = BetState(default_config, depth)
        for _ in range(4):  # limp, check, check, check
            s.apply(next(a for a in s.legal_actions() if a.token == "c"))
        assert s.street == 2
        return s

    deep_tos = [a.to for a in reach_turn(200).legal_actions() if a.token.startswith("r")]
    assert 40 in deep_tos, f"2x-pot overbet missing at 200bb: {deep_tos}"
    shallow_tos = [a.to for a in reach_turn(60).legal_actions() if a.token.startswith("r")]
    assert 40 not in shallow_tos, f"overbet should be absent below 100bb: {shallow_tos}"


def test_chip_conservation_random_playouts(default_config):
    rng = random.Random(9)
    for depth in [10, 25, 60, 100, 200]:
        for _ in range(300):
            s = BetState(default_config, depth)
            while s.terminal is None:
                acts = s.legal_actions()
                assert acts, "no legal actions at non-terminal state"
                s.apply(rng.choice(acts))
                assert s.committed[0] <= s.stack and s.committed[1] <= s.stack
                assert len(s.seq) <= MAX_TOKENS

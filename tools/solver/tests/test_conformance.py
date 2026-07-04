"""Cross-language conformance: the Python betting engine must replay every
sequence in a kernel-produced artifact and derive identical legal actions.

This is the contract that keeps the Lab/advisor (Python) and the trainer
(Rust) — and eventually the TS runtime port — from silently diverging.
"""

from tilted_solver.betting import replay, tokenize_seq
from tilted_solver.cards import parse_cards, preflop_class


def test_python_replays_every_artifact_sequence(pilot_artifact):
    art = pilot_artifact
    config = art.config
    checked = 0
    for depth in art.depths:
        for street in range(4):
            for seq in art.sequences(depth, street)[:600]:
                rows = art.lookup_all_buckets(depth, street, seq)
                assert rows, f"no rows for seq {seq!r}"
                state = replay(config, depth, tokenize_seq(seq))
                assert state.terminal is None, f"seq {seq!r} replays to terminal"
                assert state.street == street, (
                    f"street mismatch for {seq!r}: python {state.street} vs artifact {street}"
                )
                legal = state.legal_actions()
                tokens = [a.token for a in legal]
                tos = [a.to for a in legal]
                row = rows[0]
                assert tokens == row.tokens, (
                    f"token mismatch for {seq!r}: python {tokens} vs kernel {row.tokens}"
                )
                assert tos == row.tos, (
                    f"amount mismatch for {seq!r}: python {tos} vs kernel {row.tos}"
                )
                checked += 1
    assert checked > 500, f"conformance test barely ran ({checked} sequences)"


def test_preflop_class_matches_kernel(pilot_artifact):
    """Preflop bucketing is computed natively in Python; pin it to the kernel."""
    art = pilot_artifact
    cases = [("Ah As", "AA"), ("Ah Kh", "AKs"), ("Ad Kc", "AKo"), ("2c 2d", "22"), ("7h 2c", "72o")]
    for hole, _name in cases:
        cards = parse_cards(hole)
        py = preflop_class(cards[0], cards[1])
        kernel = art.assign_bucket(0, hole, "")
        assert py == kernel


def test_postflop_bucket_via_kernel_is_stable(pilot_artifact):
    art = pilot_artifact
    b1 = art.assign_bucket(1, "Ah Kh", "Qh Jh Th")
    b2 = art.assign_bucket(1, "Ah Kh", "Qh Jh Th")
    assert b1 == b2
    n_flop = art.buckets["flop"]
    assert b1 >= len(n_flop) * 0.85, f"royal flush should bucket near the top: {b1}"
    trash = art.assign_bucket(1, "7c 2d", "Qh Jh Th")
    assert trash < b1

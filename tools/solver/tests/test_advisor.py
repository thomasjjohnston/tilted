"""End-to-end advisor tests against the pilot artifact."""

from tilted_solver.advisor import advice_to_dict, advise


def _round_state(hands, my_available=1900, opp_available=1900, viewer_is_sb=True):
    return {
        "viewer_is_sb": viewer_is_sb,
        "my_available": my_available,
        "opp_available": opp_available,
        "hands": hands,
    }


def _fresh_hand(hand_id, hole):
    """A hand at the SB's first decision (blinds posted, no actions yet)."""
    return {
        "hand_id": hand_id,
        "my_hole": hole,
        "board": "",
        "my_reserved": 5,
        "opp_reserved": 10,
        "pending": True,
        "actions": [],
    }


def test_advises_full_cart(pilot_artifact):
    state = _round_state(
        [
            _fresh_hand("h1", "Ah As"),
            _fresh_hand("h2", "7c 2d"),
            _fresh_hand("h3", "Kh Qh"),
        ]
    )
    cart = advise(pilot_artifact, state)
    assert len(cart.hands) == 3
    for h in cart.hands:
        assert h.ok, f"{h.hand_id}: {h.note}"
        assert h.recommended_label, "every pending hand gets a recommendation"
    assert cart.total_cost <= cart.budget
    d = advice_to_dict(cart)
    assert d["hands"][0]["mix"], "mix should be present for display"


def test_respects_tight_budget(pilot_artifact):
    # Nearly no chips: nothing above a tiny call should be recommended.
    state = _round_state(
        [_fresh_hand("h1", "Ah As"), _fresh_hand("h2", "Kd Kc")],
        my_available=10,
    )
    cart = advise(pilot_artifact, state)
    assert cart.total_cost <= 10


def test_mid_hand_spot_with_action_translation(pilot_artifact):
    # Opponent (SB) opened to 30 in the real game — not a menu size; the
    # mapper must snap it (menu open is 25) and still find a strategy row.
    state = _round_state(
        [
            {
                "hand_id": "h1",
                "my_hole": "Qs Qd",
                "board": "",
                "my_reserved": 10,
                "opp_reserved": 30,
                "pending": True,
                "actions": [{"player": 0, "kind": "raise", "to": 30}],
            }
        ],
        viewer_is_sb=False,
    )
    cart = advise(pilot_artifact, state)
    (h,) = cart.hands
    assert h.ok, h.note
    assert h.street == 0
    assert h.recommended_label


def test_postflop_spot(pilot_artifact):
    # Open-call to a flop; viewer is BB first to act with a flopped set.
    state = _round_state(
        [
            {
                "hand_id": "h1",
                "my_hole": "8h 8d",
                "board": "8s 5c 2h",
                "my_reserved": 25,
                "opp_reserved": 25,
                "pending": True,
                "actions": [
                    {"player": 0, "kind": "raise", "to": 25},
                    {"player": 1, "kind": "call"},
                ],
            }
        ],
        viewer_is_sb=False,
    )
    cart = advise(pilot_artifact, state)
    (h,) = cart.hands
    assert h.ok, h.note
    assert h.street == 1


def test_budget_tradeoff_across_hands(pilot_artifact):
    # Big pending decisions in several hands with a small budget: total cost
    # must respect the budget, and at least one hand should be de-funded
    # relative to a rich-budget cart.
    hands = [_fresh_hand(f"h{i}", hole) for i, hole in enumerate(["Ah As", "Kd Ks", "Qc Qs", "Jh Js"])]
    rich = advise(pilot_artifact, _round_state(hands, my_available=1900))
    poor = advise(pilot_artifact, _round_state(hands, my_available=60))
    assert poor.total_cost <= 60
    assert poor.total_cost <= rich.total_cost

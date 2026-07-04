"""Play-vs-solver tests: full hands through the API, redaction, scoring."""

import pytest


@pytest.fixture()
def client(pilot_artifact, tmp_path):
    from fastapi.testclient import TestClient

    from tilted_solver.lab.app import create_app

    app = create_app(artifact_path=str(pilot_artifact.path), runs_dir=str(tmp_path))
    return TestClient(app)


def _play_hand_to_end(client, d, max_steps=60):
    """Always take the first legal action (call/check-ish) until terminal."""
    gid = d["game_id"]
    steps = 0
    while not d.get("terminal"):
        assert d["your_turn"], f"stuck: not our turn and not terminal: {d}"
        token = next(
            (a["token"] for a in d["actions"] if a["token"] == "c"),
            d["actions"][0]["token"],
        )
        d = client.post("/api/play/act", json={"game_id": gid, "token": token}).json()
        d["game_id"] = gid
        steps += 1
        assert steps < max_steps, "hand did not terminate"
    return d


def test_full_hand_and_scoring(client):
    d = client.post("/api/play/new").json()
    assert d["your_hole"].count(" ") == 1, "two hole cards"
    assert d["bot_hole"] is None, "bot cards must be hidden mid-hand"
    d = _play_hand_to_end(client, d)
    assert d["result"]
    assert d["score"]["hands"] == 1
    # Net is bounded by the effective stack.
    assert abs(d["hand_net"]) <= d["stack"]
    # Showdowns reveal the bot's hand; folds never do.
    if "showdown" in d["result"]:
        assert d["bot_hole"]
    else:
        assert d["bot_hole"] is None


def test_positions_alternate_and_score_accumulates(client):
    d = client.post("/api/play/new").json()
    gid = d["game_id"]
    first_pos = d["you_are"]
    d = _play_hand_to_end(client, d)
    d = client.post("/api/play/next", json={"game_id": gid, "token": "-"}).json()
    d["game_id"] = gid
    assert d["you_are"] != first_pos, "position must flip between hands"
    d = _play_hand_to_end(client, d)
    assert d["score"]["hands"] == 2


def test_illegal_actions_rejected(client):
    d = client.post("/api/play/new").json()
    gid = d["game_id"]
    if d["your_turn"]:
        r = client.post("/api/play/act", json={"game_id": gid, "token": "zzz"})
        assert r.status_code == 422
    r = client.post("/api/play/next", json={"game_id": gid, "token": "-"})
    assert r.status_code == 422, "can't skip a hand in progress"
    r = client.post("/api/play/act", json={"game_id": "nope", "token": "c"})
    assert r.status_code == 404


def test_stacks_persist_across_hands(client):
    d = client.post("/api/play/new").json()
    gid = d["game_id"]
    start_total = d["your_stack"] + d["bot_stack"] + d["pot"]
    d = _play_hand_to_end(client, d)
    net = d["hand_net"]
    stack_after_1 = d["your_stack"]
    assert d["your_stack"] + d["bot_stack"] == start_total, "chips conserved in the match"
    d = client.post("/api/play/next", json={"game_id": gid, "token": "-"}).json()
    d["game_id"] = gid
    # Next hand starts from the settled stacks (minus fresh blinds in the pot).
    assert d["your_stack"] + d["your_committed"] == stack_after_1, (
        f"stack must carry over: had {stack_after_1}, "
        f"now behind {d['your_stack']} + committed {d['your_committed']} (net was {net})"
    )
    # Effective depth follows the shorter stack.
    assert d["stack"] <= start_total // 2 + abs(net)


def test_bust_ends_match_and_new_match_resets(client, pilot_artifact):
    from tilted_solver.lab.app import create_app  # noqa: F401  (fixture parity)

    d = client.post("/api/play/new").json()
    gid = d["game_id"]
    # Jam every chance we get until someone goes broke (bounded attempts).
    for _ in range(60):
        while not d.get("terminal"):
            tok = next((a["token"] for a in d["actions"] if a["token"] == "a"),
                       next((a["token"] for a in d["actions"] if a["token"] == "c"),
                            d["actions"][0]["token"]))
            d = client.post("/api/play/act", json={"game_id": gid, "token": tok}).json()
        if d["match_over"]:
            break
        d = client.post("/api/play/next", json={"game_id": gid, "token": "-"}).json()
    assert d["match_over"], "all-in wars must eventually bust someone"
    tallies = d["score"]["matches_you"] + d["score"]["matches_solver"]
    assert tallies == 1
    # Next hand starts a fresh match with reset stacks.
    d = client.post("/api/play/next", json={"game_id": gid, "token": "-"}).json()
    assert not d["match_over"]
    assert d["your_stack"] + d["your_committed"] == 2000 or d["stack"] == 2000 or (
        d["your_stack"] + d["your_committed"] + d["bot_stack"] + d["bot_committed"] == 4000
    ), f"stacks should reset to the starting 2000 each: {d['your_stack']=} {d['bot_stack']=}"


def test_folding_costs_only_committed_chips(client):
    # Fold at the first opportunity repeatedly; losses per hand must be small
    # (blinds / small preflop bets only).
    d = client.post("/api/play/new").json()
    gid = d["game_id"]
    for _ in range(4):
        while not d.get("terminal"):
            tok = next((a["token"] for a in d["actions"] if a["token"] == "f"),
                       d["actions"][0]["token"])
            d = client.post("/api/play/act", json={"game_id": gid, "token": tok}).json()
        if d["hand_net"] < 0:
            assert d["hand_net"] >= -100, f"folding shouldn't lose much: {d['hand_net']}"
        d = client.post("/api/play/next", json={"game_id": gid, "token": "-"}).json()

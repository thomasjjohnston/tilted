"""Solver Lab API tests (FastAPI TestClient against the pilot artifact)."""

import pytest


@pytest.fixture()
def client(pilot_artifact, tmp_path):
    from fastapi.testclient import TestClient

    from tilted_solver.lab.app import create_app

    app = create_app(artifact_path=str(pilot_artifact.path), runs_dir=str(tmp_path))
    return TestClient(app)


def test_meta_and_index(client):
    assert client.get("/").status_code == 200
    meta = client.get("/api/meta").json()
    assert meta["depths"], "artifact should expose depths"


def test_preflop_grid(client):
    meta = client.get("/api/meta").json()
    depth = meta["depths"][0]
    d = client.get(f"/api/grid?depth_bb={depth}&street=0&seq=").json()
    assert len(d["cells"]) > 150, "most of the 169 classes should have data"
    cell = d["cells"][0]
    assert abs(sum(cell["strategy"]) - 1.0) < 1e-3  # probs rounded to 4dp in the API
    assert "name" in cell


def test_advise_endpoint(client):
    state = {
        "viewer_is_sb": True,
        "my_available": 500,
        "opp_available": 500,
        "hands": [
            {"hand_id": "h1", "my_hole": "Ah As", "board": "", "my_reserved": 5,
             "opp_reserved": 10, "pending": True, "actions": []},
        ],
    }
    d = client.post("/api/advise", json={"round_state": state}).json()
    assert d["hands"][0]["recommended"]
    assert d["total_cost"] <= 500


def test_advise_rejects_garbage(client):
    r = client.post("/api/advise", json={"round_state": {"nope": 1}})
    assert r.status_code == 422


def test_quiz_single_roundtrip(client):
    spot = client.get("/api/quiz/next?mode=single").json()
    assert spot["options"], spot
    ans = client.post(
        "/api/quiz/answer",
        json={"quiz_id": spot["quiz_id"], "token": spot["options"][0]["token"]},
    ).json()
    assert "ev_loss" in ans
    stats = client.get("/api/quiz/stats").json()
    assert stats["total_answered"] == 1


def test_quiz_turn_roundtrip(client):
    spot = client.get("/api/quiz/next?mode=turn").json()
    assert spot["hands"] and spot["budget"] > 0
    picks = {h["hand_id"]: h["options"][0]["token"] for h in spot["hands"]}
    ans = client.post(
        "/api/quiz/answer", json={"quiz_id": spot["quiz_id"], "picks": picks}
    ).json()
    assert "ev_loss" in ans and "per_hand" in ans

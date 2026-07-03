"""Solver Lab: local FastAPI app serving the explorer, composer, and quiz."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..advisor import advice_to_dict, advise
from ..artifact import Artifact
from ..cards import preflop_class_name
from .play import PlayEngine
from .quiz import QuizEngine

STATIC = Path(__file__).parent / "static"


class AdviseRequest(BaseModel):
    round_state: dict
    shadow_price: float = 1.0
    temperature: float = 0.0
    seed: int | None = None


class QuizAnswer(BaseModel):
    quiz_id: str
    token: str | None = None  # single mode
    picks: dict[str, str] | None = None  # turn mode


class PlayAction(BaseModel):
    game_id: str
    token: str


def create_app(artifact_path: str, runs_dir: str) -> FastAPI:
    artifact = Artifact(artifact_path)
    runs = Path(runs_dir)
    runs.mkdir(parents=True, exist_ok=True)
    quiz = QuizEngine(artifact, runs / "lab.db")
    play = PlayEngine(artifact, start_depth_bb=200)

    app = FastAPI(title="Tilted Solver Lab")

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/meta")
    def meta():
        return {
            "artifact": str(artifact.path),
            "depths": artifact.depths,
            "config": artifact.config,
            "buckets": {
                "flop": len(artifact.buckets["flop"]) + 1,
                "turn": len(artifact.buckets["turn"]) + 1,
                "river": len(artifact.buckets["river"]) + 1,
            },
        }

    @app.get("/api/sequences")
    def sequences(depth_bb: int, street: int):
        seqs = artifact.sequences(depth_bb, street)
        return {"sequences": seqs[:500], "total": len(seqs)}

    @app.get("/api/grid")
    def grid(depth_bb: int, street: int, seq: str = ""):
        rows = artifact.lookup_all_buckets(depth_bb, street, seq)
        if not rows:
            raise HTTPException(404, f"no data for depth={depth_bb} street={street} seq={seq!r}")
        out = []
        for r in rows:
            cell = {
                "bucket": r.bucket,
                "tokens": r.tokens,
                "tos": r.tos,
                "strategy": [round(p, 4) for p in r.strategy],
                "ev": [round(e, 2) if e == e else None for e in r.ev] if r.ev else None,
                "visits": r.visits,
            }
            if street == 0:
                cell["name"] = preflop_class_name(r.bucket)
            out.append(cell)
        return {"cells": out, "street": street, "seq": seq, "depth_bb": depth_bb}

    @app.post("/api/advise")
    def advise_endpoint(req: AdviseRequest):
        try:
            cart = advise(
                artifact,
                req.round_state,
                shadow_price=req.shadow_price,
                temperature=req.temperature,
                seed=req.seed,
            )
        except (KeyError, ValueError, TypeError) as e:
            raise HTTPException(422, f"bad round state: {e}")
        return advice_to_dict(cart)

    @app.get("/api/quiz/next")
    def quiz_next(mode: str = "single", street: int | None = None, sharpness: float = 0.0):
        if mode == "turn":
            spot = quiz.next_turn()
        else:
            spot = quiz.next_single(street_filter=street, min_sharpness=sharpness)
        if spot is None:
            raise HTTPException(
                503, "could not generate a scenario (artifact too sparse for these filters)"
            )
        d = {k: v for k, v in spot.__dict__.items() if not k.startswith("_")}
        return d

    @app.post("/api/quiz/answer")
    def quiz_answer(ans: QuizAnswer):
        result = quiz.grade(ans.quiz_id, {"token": ans.token, "picks": ans.picks or {}})
        if result is None:
            raise HTTPException(404, "unknown or expired quiz id")
        if "error" in result:
            raise HTTPException(422, result["error"])
        return result

    @app.get("/api/quiz/stats")
    def quiz_stats():
        return quiz.stats()

    @app.post("/api/play/new")
    def play_new():
        sid = play.new_session()
        return {"game_id": sid, **play.view(sid)}

    @app.post("/api/play/act")
    def play_act(req: PlayAction):
        try:
            play.act(req.game_id, req.token)
        except KeyError:
            raise HTTPException(404, "unknown game id")
        except ValueError as e:
            raise HTTPException(422, str(e))
        return play.view(req.game_id)

    @app.post("/api/play/next")
    def play_next(req: PlayAction):  # token ignored; reuse the model
        try:
            play.next_hand(req.game_id)
        except KeyError:
            raise HTTPException(404, "unknown game id")
        except ValueError as e:
            raise HTTPException(422, str(e))
        return play.view(req.game_id)

    @app.get("/api/example-state")
    def example_state():
        example = Path(__file__).parent.parent.parent / "examples" / "round-state.json"
        return json.loads(example.read_text())

    return app

"""Command-line interface: `solver <command>`.

Commands:
  advise    — recommend a cart for a round-state JSON
  spot      — inspect the strategy for one spot (13x13 grid in the Lab is nicer)
  lab       — start the Solver Lab web app
  run       — training runner (presets: smoke / hours / until-converged)
  status    — live view of the current/last run
  selfplay  — coupled-round self-play evaluation
  bench     — kernel throughput benchmark
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SOLVER_ROOT = Path(__file__).resolve().parent.parent


def _cmd_advise(args: argparse.Namespace) -> int:
    from .advisor import advice_to_dict, advise
    from .artifact import Artifact

    artifact = Artifact(args.artifact)
    state = json.loads(Path(args.state).read_text())
    cart = advise(
        artifact,
        state,
        shadow_price=args.shadow_price,
        temperature=args.temperature,
        seed=args.seed,
    )
    print(json.dumps(advice_to_dict(cart), indent=2))
    return 0


def _cmd_spot(args: argparse.Namespace) -> int:
    from .artifact import Artifact

    artifact = Artifact(args.artifact)
    row = artifact.lookup(args.depth_bb, args.street, args.seq, args.bucket)
    if row is None:
        print("no data for that spot", file=sys.stderr)
        return 1
    print(json.dumps(row.__dict__, indent=2))
    return 0


def _cmd_lab(args: argparse.Namespace) -> int:
    import uvicorn

    from .lab.app import create_app

    app = create_app(artifact_path=args.artifact, runs_dir=args.runs_dir)
    print(f"Solver Lab: http://127.0.0.1:{args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0


def _cmd_run(args: argparse.Namespace) -> int:
    from .runner import RunSettings, run_training

    settings = RunSettings(
        run_dir=Path(args.dir),
        config_path=Path(args.config) if args.config else None,
        depths=[int(d) for d in args.depths.split(",")] if args.depths else None,
        preset=args.preset,
        hours=args.hours,
        until_converged=args.until_converged,
        converge_threshold=args.converge_threshold,
        jobs=args.jobs,
        threads_per_job=args.threads_per_job,
        ev_iters=args.ev_iters,
        chunk_minutes=args.chunk_minutes,
    )
    return run_training(settings)


def _cmd_status(args: argparse.Namespace) -> int:
    from .runner import print_status

    return print_status(Path(args.dir))


def _cmd_selfplay(args: argparse.Namespace) -> int:
    from .selfplay import run_selfplay

    return run_selfplay(
        artifact_path=args.artifact,
        rounds=args.rounds,
        seed=args.seed,
        total_chips=args.total_chips,
        advisor_kwargs={"shadow_price": args.shadow_price, "temperature": args.temperature},
        baseline=args.baseline,
    )


def _cmd_import_pg(args: argparse.Namespace) -> int:
    from .import_pg import import_artifact

    stats = import_artifact(args.artifact, args.database_url, args.min_visits)
    print(
        f"imported {stats['imported']:,} of {stats['total_rows']:,} rows "
        f"(pruned {stats['pruned']:,} below {args.min_visits} visits)"
    )
    return 0


def _cmd_bench(args: argparse.Namespace) -> int:
    import subprocess

    from .artifact import _default_kernel_bin

    return subprocess.run(
        [str(_default_kernel_bin()), "bench", "--seconds", str(args.seconds),
         "--threads", str(args.threads), "--depth-bb", str(args.depth_bb)],
    ).returncode


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="solver", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    a = sub.add_parser("advise", help="recommend a cart for a round state")
    a.add_argument("state", help="round-state JSON file")
    a.add_argument("--artifact", default=str(SOLVER_ROOT / "runs/pilot/artifact.sqlite"))
    a.add_argument("--shadow-price", type=float, default=1.0)
    a.add_argument("--temperature", type=float, default=0.0)
    a.add_argument("--seed", type=int, default=None)
    a.set_defaults(fn=_cmd_advise)

    s = sub.add_parser("spot", help="inspect one artifact row")
    s.add_argument("--artifact", default=str(SOLVER_ROOT / "runs/pilot/artifact.sqlite"))
    s.add_argument("--depth-bb", type=int, required=True)
    s.add_argument("--street", type=int, required=True)
    s.add_argument("--seq", default="")
    s.add_argument("--bucket", type=int, required=True)
    s.set_defaults(fn=_cmd_spot)

    l = sub.add_parser("lab", help="start the Solver Lab web app")
    l.add_argument("--artifact", default=str(SOLVER_ROOT / "runs/pilot/artifact.sqlite"))
    l.add_argument("--runs-dir", default=str(SOLVER_ROOT / "runs"))
    l.add_argument("--port", type=int, default=8321)
    l.set_defaults(fn=_cmd_lab)

    r = sub.add_parser("run", help="training runner")
    r.add_argument("--dir", default=str(SOLVER_ROOT / "runs/main"))
    r.add_argument("--config", default=str(SOLVER_ROOT / "configs/default.json"))
    r.add_argument("--depths", default=None, help="comma-separated bb depths (default from preset)")
    r.add_argument("--preset", choices=["smoke", "full"], default=None)
    r.add_argument("--hours", type=float, default=None)
    r.add_argument("--until-converged", action="store_true")
    r.add_argument("--converge-threshold", type=float, default=0.02,
                   help="probe L1 delta below which a depth counts as converged")
    r.add_argument("--jobs", type=int, default=None, help="concurrent depth jobs (default: CPU cores)")
    r.add_argument("--threads-per-job", type=int, default=1)
    r.add_argument("--ev-iters", type=int, default=300_000)
    r.add_argument("--chunk-minutes", type=float, default=None,
                   help="length of each training chunk (default: 10 smoke, 20 otherwise)")
    r.set_defaults(fn=_cmd_run)

    st = sub.add_parser("status", help="show run progress")
    st.add_argument("--dir", default=str(SOLVER_ROOT / "runs/main"))
    st.set_defaults(fn=_cmd_status)

    sp = sub.add_parser("selfplay", help="coupled-round self-play evaluation")
    sp.add_argument("--artifact", default=str(SOLVER_ROOT / "runs/pilot/artifact.sqlite"))
    sp.add_argument("--rounds", type=int, default=2000)
    sp.add_argument("--seed", type=int, default=1)
    sp.add_argument("--total-chips", type=int, default=400,
                    help="per-player bankroll for the round (small = budget binds = portfolio matters)")
    sp.add_argument("--shadow-price", type=float, default=1.0)
    sp.add_argument("--temperature", type=float, default=0.0)
    sp.add_argument("--baseline", choices=["solo", "always-call", "fold-happy"], default="solo")
    sp.set_defaults(fn=_cmd_selfplay)

    ip = sub.add_parser("import-pg", help="import artifact strategies into Tilted's Postgres")
    ip.add_argument("--artifact", default=str(SOLVER_ROOT / "runs/best/artifact.sqlite"))
    ip.add_argument("--database-url", required=True)
    ip.add_argument("--min-visits", type=float, default=20.0)
    ip.set_defaults(fn=_cmd_import_pg)

    b = sub.add_parser("bench", help="kernel throughput benchmark")
    b.add_argument("--seconds", type=float, default=20)
    b.add_argument("--threads", type=int, default=4)
    b.add_argument("--depth-bb", type=int, default=100)
    b.set_defaults(fn=_cmd_bench)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())

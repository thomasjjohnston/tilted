"""Training runner: presets, scheduling, live progress, until-converged.

Design: the Rust kernel runs fixed *chunks* (`train --minutes N`) and reports
a convergence probe per chunk; this runner is the policy layer that schedules
chunks across depths, renders progress, and decides when each depth is done.
Checkpoints make every mode resumable — Ctrl-C is always safe.

Modes:
  --preset smoke      one short chunk per depth + export (pipeline validation)
  --hours H           time-boxed: repeated chunks until the box closes
  --until-converged   chunks until every depth's probe delta < threshold
                      (twice consecutively); freed slots go to stragglers

Convergence metric ("probe delta"): mean L1 movement of the average strategy
on a fixed 20k-infoset probe between consecutive checkpoints — "how much is
the answer still changing", 0..1. The ETA extrapolates delta ~ C/iterations,
so early estimates are rough and tighten as the run progresses.
"""

from __future__ import annotations

import json
import os
import select
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from rich.console import Console
from rich.live import Live
from rich.table import Table

DEFAULT_DEPTHS = [10, 15, 25, 40, 60, 100, 150, 200]
SMOKE_DEPTHS = [10, 25, 60, 100, 200]
CHUNK_MINUTES = 20.0
SMOKE_CHUNK_MINUTES = 10.0


@dataclass
class RunSettings:
    run_dir: Path
    config_path: Path | None
    depths: list[int] | None
    preset: str | None  # "smoke" | "full" | None
    hours: float | None
    until_converged: bool
    converge_threshold: float = 0.02
    jobs: int | None = None
    threads_per_job: int = 1
    ev_iters: int = 300_000
    chunk_minutes: float | None = None


@dataclass
class DepthState:
    depth: int
    iters: int = 0
    ips: float = 0.0
    delta: float | None = None
    delta_history: list[tuple[int, float]] = field(default_factory=list)
    consecutive_converged: int = 0
    state: str = "queued"  # queued | running | waiting | converged | done
    proc: subprocess.Popen | None = None
    chunk_started: float = 0.0


def _kernel_bin() -> Path:
    from .artifact import _default_kernel_bin

    return _default_kernel_bin()


def _load_history(run_dir: Path, depth: int) -> list[dict]:
    hist = run_dir / f"depth-{depth}" / "history.jsonl"
    if not hist.exists():
        return []
    return [json.loads(l) for l in hist.read_text().splitlines() if l.strip()]


def _eta_seconds(d: DepthState, threshold: float) -> float | None:
    """Extrapolate delta ~ C / iters to estimate time-to-threshold."""
    pts = [(i, x) for i, x in d.delta_history if x > 0]
    if len(pts) < 2 or d.ips <= 0:
        return None
    i, x = pts[-1]
    if x <= threshold:
        return 0.0
    c = x * i
    iters_needed = c / threshold
    return max(0.0, (iters_needed - i) / d.ips)


def _fmt_eta(sec: float | None) -> str:
    if sec is None:
        return "…"
    if sec == 0:
        return "now"
    if sec < 3600:
        return f"~{sec / 60:.0f}m"
    return f"~{sec / 3600:.1f}h"


def run_training(s: RunSettings) -> int:
    console = Console()
    kernel = _kernel_bin()
    s.run_dir.mkdir(parents=True, exist_ok=True)

    depths = s.depths or (SMOKE_DEPTHS if s.preset == "smoke" else DEFAULT_DEPTHS)
    jobs = s.jobs or max(1, os.cpu_count() or 4)
    chunk_min = s.chunk_minutes or (SMOKE_CHUNK_MINUTES if s.preset == "smoke" else CHUNK_MINUTES)
    deadline = time.time() + s.hours * 3600 if s.hours else None
    one_chunk_only = s.preset == "smoke" and not s.until_converged and not s.hours

    # 1. Buckets (once per run dir; depth-independent).
    buckets_file = s.run_dir / "buckets.json"
    if not buckets_file.exists():
        console.print("[bold]building card-abstraction buckets[/] (one-time, a few minutes)…")
        cmd = [str(kernel), "buckets", "--out", str(buckets_file)]
        if s.config_path:
            cmd += ["--config", str(s.config_path)]
        subprocess.run(cmd, check=True)

    # 2. Depth states, resumed from history.
    states = {d: DepthState(depth=d) for d in depths}
    for d, st in states.items():
        for rec in _load_history(s.run_dir, d):
            st.iters = rec.get("iters", st.iters)
            if rec.get("probe_delta") is not None:
                st.delta = rec["probe_delta"]
                st.delta_history.append((rec["iters"], rec["probe_delta"]))
        if st.delta is not None and st.delta < s.converge_threshold:
            st.consecutive_converged = 1  # one more confirming chunk needed

    chunks_done = {d: 0 for d in depths}

    def start_chunk(st: DepthState) -> None:
        cmd = [
            str(kernel), "train",
            "--buckets", str(buckets_file),
            "--depth-bb", str(st.depth),
            "--dir", str(s.run_dir),
            "--minutes", str(chunk_min),
            "--threads", str(s.threads_per_job),
            "--seed", str(1 + chunks_done[st.depth]),
        ]
        if s.config_path:
            cmd = cmd[:2] + ["--config", str(s.config_path)] + cmd[2:]
        st.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, bufsize=1)
        st.state = "running"
        st.chunk_started = time.time()

    def drain(st: DepthState) -> None:
        """Non-blockingly read progress lines from a running chunk."""
        proc = st.proc
        assert proc and proc.stdout
        while True:
            r, _, _ = select.select([proc.stdout], [], [], 0)
            if not r:
                break
            line = proc.stdout.readline()
            if not line:
                break
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("t") == "progress":
                st.iters = rec["iters"]
                st.ips = rec["ips"]
            elif rec.get("t") == "checkpoint":
                st.iters = rec["iters"]
                if rec.get("probe_delta") is not None:
                    st.delta = rec["probe_delta"]
                    st.delta_history.append((rec["iters"], rec["probe_delta"]))

    def finish_chunk(st: DepthState) -> None:
        st.proc = None
        chunks_done[st.depth] += 1
        st.state = "waiting"
        if s.until_converged and st.delta is not None:
            if st.delta < s.converge_threshold:
                st.consecutive_converged += 1
                if st.consecutive_converged >= 2:
                    st.state = "converged"
            else:
                st.consecutive_converged = 0
        elif one_chunk_only:
            st.state = "done"

    def render() -> Table:
        t = Table(title=f"Tilted solver training — {s.run_dir}")
        t.add_column("depth", justify="right")
        t.add_column("state")
        t.add_column("iterations", justify="right")
        t.add_column("it/s", justify="right")
        t.add_column("convergence Δ", justify="right")
        t.add_column("ETA to target", justify="right")
        for d in depths:
            st = states[d]
            delta = f"{st.delta:.4f}" if st.delta is not None else "—"
            eta = _fmt_eta(_eta_seconds(st, s.converge_threshold)) if s.until_converged else ""
            color = {"running": "green", "converged": "bold blue", "done": "bold blue"}.get(st.state, "")
            state_txt = f"[{color}]{st.state}[/]" if color else st.state
            t.add_row(f"{d}bb", state_txt, f"{st.iters:,}", f"{st.ips:,.0f}", delta, eta)
        return t

    def write_status() -> None:
        (s.run_dir / "status.json").write_text(json.dumps({
            "updated_at": time.time(),
            "threshold": s.converge_threshold,
            "mode": ("until-converged" if s.until_converged else
                     f"hours={s.hours}" if s.hours else (s.preset or "chunks")),
            "depths": {
                str(d): {
                    "state": st.state, "iters": st.iters, "ips": st.ips,
                    "delta": st.delta,
                    "eta_sec": _eta_seconds(st, s.converge_threshold),
                }
                for d, st in states.items()
            },
        }, indent=2))

    console.print(
        f"[bold]run[/]: depths {depths} · {jobs} concurrent jobs × {s.threads_per_job} thread(s) "
        f"· chunk {chunk_min:.0f}m · "
        + ("until Δ < " + str(s.converge_threshold) if s.until_converged
           else f"{s.hours}h time box" if s.hours else "one chunk each (smoke)")
    )
    console.print("[dim]Ctrl-C any time — checkpoints make every mode resumable.[/]")

    interrupted = False
    try:
        with Live(render(), console=console, refresh_per_second=2) as live:
            while True:
                # Reap finished chunks.
                for st in states.values():
                    if st.proc is not None:
                        drain(st)
                        if st.proc.poll() is not None:
                            drain(st)
                            if st.proc.returncode != 0:
                                console.print(f"[red]depth {st.depth}: chunk failed "
                                              f"(exit {st.proc.returncode})[/]")
                                st.state = "error"
                                st.proc = None
                                continue
                            finish_chunk(st)
                # Time box?
                out_of_time = deadline is not None and time.time() >= deadline
                # Schedule new chunks into free slots.
                if not out_of_time:
                    running = sum(1 for st in states.values() if st.state == "running")
                    for st in states.values():
                        if running >= jobs:
                            break
                        if st.state in ("queued", "waiting"):
                            start_chunk(st)
                            running += 1
                live.update(render())
                write_status()
                active = [st for st in states.values() if st.state == "running"]
                if not active:
                    if out_of_time:
                        console.print("[bold]time box reached[/] — checkpoints saved.")
                        break
                    if all(st.state in ("converged", "done", "error") for st in states.values()):
                        break
                time.sleep(1)
    except KeyboardInterrupt:
        interrupted = True
        console.print("\n[bold]interrupted[/] — waiting for running chunks to checkpoint…")
        for st in states.values():
            if st.proc is not None:
                st.proc.wait()
                st.state = "waiting"
        write_status()

    # 3. Export an artifact from whatever is trained.
    errored = [d for d in depths if states[d].state == "error"]
    if errored:
        console.print(
            f"[red]depths {errored} failed — skipping export.[/] "
            "Most common cause: disk full (check `df -h`). Checkpoint saves are "
            "atomic, so the last successful checkpoints are intact; free space "
            "(or grow the volume) and rerun the same command to resume."
        )
        write_status()
        return 1
    trained = [d for d in depths if (s.run_dir / f"depth-{d}" / "checkpoint.bin").exists()]
    if trained and not interrupted:
        artifact = s.run_dir / "artifact.sqlite"
        console.print(f"[bold]exporting artifact[/] ({len(trained)} depths, "
                      f"EV extraction {s.ev_iters:,} deals/depth)…")
        subprocess.run(
            [str(kernel), "export", "--dir", str(s.run_dir), "--out", str(artifact),
             "--ev-iters", str(s.ev_iters)],
            check=True,
        )
        console.print(f"[bold green]artifact ready:[/] {artifact}")
        console.print(f"explore it: [bold]uv run solver.py lab --artifact {artifact}[/]")
    elif interrupted:
        console.print("resume with the same command; export skipped "
                      "(run again or export manually when ready).")
    write_status()
    return 0


def print_status(run_dir: Path) -> int:
    console = Console()
    status_file = run_dir / "status.json"
    if not status_file.exists():
        console.print(f"no status.json in {run_dir} — has a run started there?")
        return 1
    d = json.loads(status_file.read_text())
    age = time.time() - d["updated_at"]
    t = Table(title=f"{run_dir} · mode {d['mode']} · updated {age:.0f}s ago"
              + ("  [red](stale — runner not active?)[/]" if age > 120 else ""))
    t.add_column("depth", justify="right")
    t.add_column("state")
    t.add_column("iterations", justify="right")
    t.add_column("it/s", justify="right")
    t.add_column("convergence Δ", justify="right")
    t.add_column("ETA", justify="right")
    for depth, st in sorted(d["depths"].items(), key=lambda kv: int(kv[0])):
        t.add_row(
            f"{depth}bb", st["state"], f"{st['iters']:,}",
            f"{st['ips']:,.0f}" if st["ips"] else "—",
            f"{st['delta']:.4f}" if st["delta"] is not None else "—",
            _fmt_eta(st["eta_sec"]),
        )
    console.print(t)
    return 0

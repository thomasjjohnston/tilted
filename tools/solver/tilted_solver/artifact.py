"""Reader for the SQLite strategy artifact produced by the Rust kernel."""

from __future__ import annotations

import json
import sqlite3
import subprocess
from dataclasses import dataclass
from pathlib import Path

STREETS = ["preflop", "flop", "turn", "river"]


@dataclass
class InfosetRow:
    depth_bb: int
    street: int
    seq: str
    bucket: int
    tokens: list[str]
    tos: list[int]
    strategy: list[float]
    ev: list[float] | None
    ev_n: list[int] | None
    visits: float


class Artifact:
    def __init__(self, path: str | Path, kernel_bin: str | Path | None = None):
        self.path = Path(path)
        if not self.path.exists():
            raise FileNotFoundError(f"artifact not found: {self.path}")
        # check_same_thread=False: the Lab serves requests from a threadpool.
        # Read-only connection, so cross-thread use is safe.
        self.db = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, check_same_thread=False)
        self.config = json.loads(self._meta("config"))
        self.buckets = json.loads(self._meta("buckets"))
        self.depths: list[int] = json.loads(self._meta("depths"))
        version = int(self._meta("schema_version"))
        if version != 1:
            raise ValueError(f"unsupported artifact schema version {version}")
        self.kernel_bin = Path(kernel_bin) if kernel_bin else _default_kernel_bin()
        self._buckets_file: Path | None = None

    def _meta(self, key: str) -> str:
        row = self.db.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        if row is None:
            raise KeyError(f"artifact meta missing key {key!r}")
        return row[0]

    def nearest_depth(self, effective_stack_chips: int) -> int:
        bb = self.config["blind_big"]
        target = effective_stack_chips / bb
        return min(self.depths, key=lambda d: abs(d - target))

    def lookup(self, depth_bb: int, street: int, seq: str, bucket: int) -> InfosetRow | None:
        row = self.db.execute(
            "SELECT tokens, tos, strategy, ev, ev_n, visits FROM strategies"
            " WHERE depth_bb=? AND street=? AND seq=? AND bucket=?",
            (depth_bb, street, seq, bucket),
        ).fetchone()
        if row is None:
            return None
        tokens, tos, strategy, ev, ev_n, visits = row
        return InfosetRow(
            depth_bb=depth_bb,
            street=street,
            seq=seq,
            bucket=bucket,
            tokens=json.loads(tokens),
            tos=json.loads(tos),
            strategy=json.loads(strategy),
            ev=json.loads(ev) if ev else None,
            ev_n=json.loads(ev_n) if ev_n else None,
            visits=visits,
        )

    def lookup_all_buckets(self, depth_bb: int, street: int, seq: str) -> list[InfosetRow]:
        rows = self.db.execute(
            "SELECT bucket, tokens, tos, strategy, ev, ev_n, visits FROM strategies"
            " WHERE depth_bb=? AND street=? AND seq=? ORDER BY bucket",
            (depth_bb, street, seq),
        ).fetchall()
        return [
            InfosetRow(
                depth_bb=depth_bb,
                street=street,
                seq=seq,
                bucket=r[0],
                tokens=json.loads(r[1]),
                tos=json.loads(r[2]),
                strategy=json.loads(r[3]),
                ev=json.loads(r[4]) if r[4] else None,
                ev_n=json.loads(r[5]) if r[5] else None,
                visits=r[6],
            )
            for r in rows
        ]

    def sequences(self, depth_bb: int, street: int) -> list[str]:
        rows = self.db.execute(
            "SELECT DISTINCT seq FROM strategies WHERE depth_bb=? AND street=? ORDER BY seq",
            (depth_bb, street),
        ).fetchall()
        return [r[0] for r in rows]

    # -- bucket assignment (delegated to the kernel for bit-exact parity) ----

    def buckets_file(self) -> Path:
        """Materialize the buckets JSON next to the artifact for kernel calls."""
        if self._buckets_file is None or not self._buckets_file.exists():
            p = self.path.with_suffix(".buckets.json")
            p.write_text(json.dumps(self.buckets))
            self._buckets_file = p
        return self._buckets_file

    def assign_bucket(self, street: int, hole: str, board: str) -> int:
        """Bucket a concrete hand by shelling to the kernel (deterministic EHS)."""
        if street == 0:
            from .cards import parse_cards, preflop_class

            cards = parse_cards(hole)
            return preflop_class(cards[0], cards[1])
        out = subprocess.run(
            [
                str(self.kernel_bin),
                "bucket-assign",
                "--buckets",
                str(self.buckets_file()),
                "--street",
                STREETS[street],
                "--hole",
                hole,
                "--board",
                board,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return int(json.loads(out.stdout.strip().splitlines()[-1])["bucket"])


def _default_kernel_bin() -> Path:
    here = Path(__file__).resolve().parent.parent
    for profile in ("release", "debug"):
        candidate = here / "kernel" / "target" / profile / "solver-kernel"
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "solver-kernel binary not found; build it with: cargo build --release "
        "(in tools/solver/kernel)"
    )

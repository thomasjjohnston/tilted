"""Persistent kernel subprocess for fast bucket assignment.

One `solver-kernel bucket-assign --batch` process, queried over a pipe —
avoids per-query process spawns during self-play (thousands of assignments).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

STREETS = ["preflop", "flop", "turn", "river"]


class BucketClient:
    def __init__(self, kernel_bin: Path, buckets_file: Path):
        self.proc = subprocess.Popen(
            [str(kernel_bin), "bucket-assign", "--buckets", str(buckets_file), "--batch"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

    def assign(self, street: int, hole: str, board: str) -> int:
        if street == 0:
            from .cards import parse_cards, preflop_class

            cards = parse_cards(hole)
            return preflop_class(cards[0], cards[1])
        assert self.proc.stdin and self.proc.stdout
        query = json.dumps({"street": STREETS[street], "hole": hole, "board": board})
        self.proc.stdin.write(query + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("bucket-assign subprocess died")
        return int(json.loads(line)["bucket"])

    def close(self) -> None:
        if self.proc.stdin:
            self.proc.stdin.close()
        self.proc.wait(timeout=10)

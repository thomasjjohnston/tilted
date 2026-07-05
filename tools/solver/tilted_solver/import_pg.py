"""Import a solver artifact into the Tilted server's Postgres.

Frequencies only (the bot samples mixed strategies; EVs stay offline), with
low-visit rows pruned — they carry mostly noise and the bot has an explicit
off-book fallback. Uses COPY for speed; the whole import runs in one
transaction, replacing any previous strategy set atomically.

Usage:
  uv run solver.py import-pg --artifact runs/best/artifact.sqlite \
      --database-url postgres://... [--min-visits 20]
"""

from __future__ import annotations

import io
import json
import sqlite3
from pathlib import Path


def import_artifact(artifact_path: str, database_url: str, min_visits: float = 20.0) -> dict:
    try:
        import psycopg
    except ImportError as e:
        raise SystemExit(
            "psycopg is required for import-pg: add it with "
            "`uv add psycopg[binary]` in tools/solver"
        ) from e

    src = sqlite3.connect(f"file:{Path(artifact_path)}?mode=ro", uri=True)
    meta = dict(src.execute("SELECT key, value FROM meta").fetchall())
    total = src.execute("SELECT COUNT(*) FROM strategies").fetchone()[0]

    stats = {"total_rows": total, "imported": 0, "pruned": 0}
    with psycopg.connect(database_url) as conn:
        with conn.transaction():
            cur = conn.cursor()
            # Replace-all semantics: the strategy set is a versioned unit.
            cur.execute("DELETE FROM solver_strategies")
            cur.execute("DELETE FROM solver_meta")
            for key in ("config", "buckets", "depths", "schema_version"):
                if key in meta:
                    value = meta[key]
                    # meta values are JSON strings in the artifact; store as jsonb.
                    try:
                        parsed = json.loads(value)
                    except (json.JSONDecodeError, TypeError):
                        parsed = value
                    cur.execute(
                        "INSERT INTO solver_meta (key, value) VALUES (%s, %s)",
                        (key, json.dumps(parsed)),
                    )
            cur.execute(
                "INSERT INTO solver_meta (key, value) VALUES (%s, %s)",
                ("import", json.dumps({"source": str(artifact_path), "min_visits": min_visits})),
            )

            rows = src.execute(
                "SELECT depth_bb, street, seq, bucket, tokens, strategy, visits FROM strategies"
            )
            buf = io.StringIO()
            batch = 0
            with cur.copy(
                "COPY solver_strategies (depth_bb, street, seq, bucket, tokens, strategy)"
                " FROM STDIN"
            ) as copy:
                for depth_bb, street, seq, bucket, tokens, strategy, visits in rows:
                    if visits < min_visits:
                        stats["pruned"] += 1
                        continue
                    copy.write_row((depth_bb, street, seq, bucket, tokens, strategy))
                    stats["imported"] += 1
                    batch += 1
            del buf
    src.close()
    return stats


def main(argv: list[str]) -> int:
    import argparse

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--artifact", required=True)
    p.add_argument("--database-url", required=True)
    p.add_argument("--min-visits", type=float, default=20.0)
    args = p.parse_args(argv)
    stats = import_artifact(args.artifact, args.database_url, args.min_visits)
    print(
        f"imported {stats['imported']:,} of {stats['total_rows']:,} rows "
        f"(pruned {stats['pruned']:,} below {args.min_visits} visits)"
    )
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main(sys.argv[1:]))

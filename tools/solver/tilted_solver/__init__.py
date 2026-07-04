"""Tilted recommendation engine: Python side of the offline solver pipeline.

The Rust kernel (tools/solver/kernel) trains strategies and exports a SQLite
artifact; this package consumes it — spot mapping, portfolio optimization,
the Solver Lab web app, self-play evaluation, and the training runner.
"""

__version__ = "0.1.0"

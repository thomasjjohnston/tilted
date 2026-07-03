#!/usr/bin/env python3
"""Launcher for the Tilted solver CLI: `uv run solver.py <command> ...`

Exists because .pth-based editable installs load unreliably on some
Python 3.14 setups (ModuleNotFoundError from the `solver` console script).
This bootstraps sys.path explicitly, so it works on any machine with the
venv synced, independent of install mechanics.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tilted_solver.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())

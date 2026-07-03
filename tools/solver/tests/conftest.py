import json
from pathlib import Path

import pytest

SOLVER_ROOT = Path(__file__).resolve().parent.parent
PILOT_ARTIFACT = SOLVER_ROOT / "runs" / "pilot" / "artifact.sqlite"


@pytest.fixture(scope="session")
def default_config() -> dict:
    return json.loads((SOLVER_ROOT / "configs" / "default.json").read_text())


@pytest.fixture(scope="session")
def pilot_artifact():
    if not PILOT_ARTIFACT.exists():
        pytest.skip(
            "pilot artifact missing — build it with the kernel "
            "(buckets + train + export into runs/pilot)"
        )
    from tilted_solver.artifact import Artifact

    return Artifact(PILOT_ARTIFACT)

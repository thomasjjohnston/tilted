#!/usr/bin/env bash
# Bootstrap a fresh EC2 instance (Amazon Linux 2023 or Ubuntu 22+) for a
# Tilted solver training run. Works on x86_64 and arm64 (Graviton).
#
# Usage (on the instance):
#   curl -fsSL <raw-url>/ec2-bootstrap.sh | bash -s -- <git-repo-url>
# or copy the repo up yourself and run: bash deploy/ec2-bootstrap.sh
set -euo pipefail

REPO_URL="${1:-}"

echo "==> installing build tools"
if command -v dnf >/dev/null; then
  sudo dnf install -y git gcc gcc-c++ make tmux
else
  sudo apt-get update -y && sudo apt-get install -y git build-essential tmux
fi

echo "==> installing rust"
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
source "$HOME/.cargo/env"

echo "==> installing uv"
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

if [ -n "$REPO_URL" ] && [ ! -d Tilted ]; then
  echo "==> cloning repo"
  git clone --depth 1 "$REPO_URL" Tilted
fi
cd "${REPO_DIR:-Tilted}/tools/solver"

echo "==> building kernel (release)"
(cd kernel && cargo build --release)

echo "==> syncing python env"
uv sync

echo "==> quick validation"
./kernel/target/release/solver-kernel toy --game kuhn --iters 2000
uv run pytest tests/test_betting.py tests/test_knapsack.py -q

cat <<'EOF'

Ready. Suggested run (inside tmux so you can disconnect):

  tmux new -s solver
  uv run solver.py bench --seconds 30 --threads $(nproc)
  uv run solver.py run --dir runs/main --until-converged \
      --jobs $(nproc) --threads-per-job 1

Detach with Ctrl-B D; check progress anytime with:
  tmux attach -t solver        # or:
  uv run solver.py status --dir runs/main

When it finishes, copy the artifact home (from your laptop):
  scp <instance>:~/Tilted/tools/solver/runs/main/artifact.sqlite runs/main/

Then TERMINATE THE INSTANCE — the artifact is all you need.
EOF

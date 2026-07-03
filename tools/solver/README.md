# Tilted Solver — recommendation engine pipeline

Offline research tool that trains near-GTO heads-up NLHE strategies and turns
them into **cart recommendations for Tilted**: per-hand strategy from MCCFR
blueprints at a grid of stack depths, plus a portfolio (knapsack) layer that
allocates the shared chip budget across the 10 parallel hands.

Not product code: nothing here runs in `apps/`. The eventual product surface
is a TS port of the thin runtime layer (spot mapper + knapsack + artifact
lookup) behind a read-only advice endpoint — see "Architecture" below.

## Layout

```
tools/solver/
├── kernel/            Rust: CFR training, card abstraction, artifact export
├── tilted_solver/     Python: advisor, Solver Lab, self-play, runner
├── tests/             Python tests incl. Rust↔Python conformance
├── configs/           Game configs (bet menus, buckets) — the rule dials
├── deploy/            EC2 bootstrap + runbook for the big run
├── examples/          Sample round-state JSON
├── runs/              (gitignored) checkpoints, buckets, artifacts
└── solver.py          CLI launcher: uv run solver.py <command>
```

## Setup

```sh
cd tools/solver
(cd kernel && cargo build --release)   # needs rustup
uv sync                                # needs uv
uv run pytest -q                       # everything green?
(cd kernel && cargo test --release)    # kernel suite (~2 min)
```

## The three runs

**1. Smoke run (~1–2h)** — validates the pipeline end to end and calibrates
throughput on this machine; produces a real (rough) artifact:

```sh
uv run solver.py run --dir runs/main --preset smoke
```

**2. Until-converged (nights on the laptop, or hours on EC2)** — trains every
depth until its convergence delta drops below threshold; fully resumable, so
run it in any number of sittings — just rerun the same command:

```sh
uv run solver.py run --dir runs/main --until-converged
uv run solver.py status --dir runs/main     # from another terminal
```

**3. Time-boxed** — `--hours 8` for "train overnight, stop cleanly".

For the EC2 option (a few dollars, done in an afternoon): `deploy/EC2.md`.

## Consuming the artifact

```sh
# The Lab: spot explorer, turn composer, quiz, stats
uv run solver.py lab --artifact runs/main/artifact.sqlite

# Cart recommendation for a round state (see examples/round-state.json)
uv run solver.py advise examples/round-state.json --artifact runs/main/artifact.sqlite

# Measure the portfolio layer's edge in coupled self-play
uv run solver.py selfplay --artifact runs/main/artifact.sqlite --total-chips 400
```

## Architecture

- **Kernel (Rust)**: external-sampling MCCFR over an abstracted HU NLHE game.
  Bet menus are config (`configs/default.json`) — depth/street-aware, with
  2x-pot overbets at ≥100bb on turn/river; changing a size is a config edit
  and a retrain, no code (golden rule 4.7). Cards abstract to E[HS]
  percentile buckets (exact 169 classes preflop). Checkpoints per chunk;
  convergence measured as average-strategy movement on a fixed probe set.
- **Artifact (SQLite)**: the cross-language contract. Per infoset: legal
  actions, average strategy, sampled per-action EVs. Browse it with any
  sqlite client. `meta` holds config + bucket boundaries, so the artifact is
  self-contained.
- **Advisor (Python)**: replays real hands through a conformance-pinned port
  of the betting engine, snaps off-menu bet sizes (action translation),
  buckets via the kernel binary (bit-exact parity), then solves an exact
  multiple-choice knapsack over pending hands. Knobs: `--shadow-price`
  (value chips above face when scarce), `--temperature` (sample near-optimal
  allocations so the engine's cart isn't a tell).
- **Validation anchors**: Kuhn/Leduc exact convergence; jam/fold solved
  exactly and matching published Nash (10bb: jam 57%, call 37%); chip
  conservation property tests; Rust↔Python conformance on every artifact
  sequence; self-play control (portfolio edge → 0 when the budget is loose).

## Known limitations (honest list)

- Blueprint quality is bounded by abstraction (bet menu + 200 buckets/street)
  and training time; per-action EVs are sampled estimates, noisy on rare
  lines. The advisor flags spots with no data instead of guessing.
- The engine plays each hand's strategy independently; joint balance across
  the 10 hands (information leakage through your visible allocation) is
  mitigated by `--temperature`, not solved. Nobody has equilibrium machinery
  for the coupled game.
- Self-play's abstract hands don't model ledger-capped call-for-less; both
  agents face the same constraint, so measured edges remain meaningful.
- 200bb trees are the biggest and converge slowest — expect the
  until-converged run to spend most of its time there.

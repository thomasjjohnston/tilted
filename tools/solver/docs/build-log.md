# Building the Tilted recommendation engine: a build log

Source notes for a blog post. One session, from "what would GTO take?" to a
converged 8-depth solver, a playable web app, and a measured answer to whether
portfolio optimization matters in Tilted's coupled game. 13 commits, ~8,300
lines, roughly $10 of cloud compute.

## The question that started it

Tilted runs ten heads-up NLHE hands in parallel off one shared chip stack.
The opening question was innocent: *what would it take to play against a
computer playing GTO, or get GTO advice?*

The theory detour that shaped everything:

- Heads-up **limit** hold'em is essentially solved (Cepheus, 2015: ~900
  CPU-core-years, 11 TB compressed). Heads-up **no-limit** has ~10^160
  decision points — a tabular solution cannot physically be written down
  (the observable universe has ~10^80 atoms). Every practical system solves
  an *abstraction*: restricted bet menus, bucketed cards.
- Tilted itself is not ten poker games. The shared budget couples the hands
  three ways: **mechanical** (chips spent in hand 1 aren't available in hand
  6 — exactly a knapsack), **intertemporal** (chips frozen by an all-in are
  locked until end of round — option value), and **informational** (your
  visible allocation across ten hands leaks relative strength — a true
  equilibrium would randomize allocations; nobody has machinery for this).
- Each Tilted hand gets its own deck (per-hand `deck_seed`), so there is no
  card-removal coupling — holding AA in one hand says nothing about another.
  The budget is the *only* mechanical coupling, which licenses the central
  decomposition:

**Layer 1**: near-GTO single-hand blueprints at a grid of stack depths
(10–200bb), trained offline, with per-action EVs extracted.
**Layer 2**: an exact multiple-choice knapsack that assembles a full turn
("the cart") from each pending hand's candidate actions under the shared
budget — plus a shadow price on scarce chips and Gumbel-noise sampling so
the engine's allocation isn't a tell.

A design insight from the product owner mid-discussion: in Tilted, going
all-in *freezes your whole stack* for the other nine hands, so 2x-pot
overbets earn a place in the bet menu as "most of the leverage without
walking away from the round." The abstraction encodes this: overbets on
turn/river at ≥100bb (later ≥60bb).

## Architecture

- **Rust kernel** (`tools/solver/kernel`): the compute — CFR training, card
  abstraction, artifact export. Sealed appliance; nobody edits it after
  validation.
- **Python everything else** (`tilted_solver/`): advisor, web Lab, self-play,
  training runner. Everything the owner will ever want to tweak.
- Contract between them: a **SQLite artifact** (strategies + sampled
  per-action EVs + bucket boundaries + config, self-contained) and a
  **conformance test** that replays every artifact betting sequence through
  the Python port of the betting engine — tokens and chip amounts must match
  exactly. Cross-language drift fails CI, not production. (First catch:
  Python's banker's rounding vs Rust's half-away-from-zero.)

## Validation chain (the part that makes it trustworthy)

1. CFR+ core on **Kuhn** (value −1/18 exact to 4 decimals) and **Leduc**
   (value −0.0856 matching published), with an exact best-response calculator
   that reports 0.0000 exploitability on a hand-constructed Kuhn equilibrium.
2. 7-card evaluator differential-tested against a brute-force
   best-5-of-21 reference over 20k random hands.
3. **Jam/fold anchor**: exact preflop push/fold solve reproduces published
   Nash — 10bb: jam 57.2% / call 37.3%; 20bb: jam 39.4% / call 21.7%;
   exploitability 0.0000 after symmetrizing the Monte Carlo equity table.
4. Chip-conservation property tests over thousands of random playouts.
5. Self-play control: the knapsack layer measured **+6.2 ± 2.4 chips/round**
   vs greedy per-hand play under a binding budget, and **0.00 ± 0.09** with a
   loose one — value exactly when theory says, never negative.

## Debugging war stories (blog gold)

- **The O(1/√T) hunt**: CFR+ converged at vanilla-CFR rate. After chasing
  averaging variants (post-update strategy, DCFR discounting), the resolution
  was epistemically humbling: CFR+'s famous O(1/T) is *empirical on large
  games*; tiny Kuhn tracks the theoretical O(1/√T). The implementation was
  correct; the expectation was wrong. Exact BR against a known equilibrium
  was the tool that proved it.
- **The 48-minute jam/fold solve**: the generic CFR walker enumerated all
  28,561 class-pair chance outcomes per iteration with string keys. Rewrote
  as a 169-dimensional vector solver: seconds. Right algorithm, wrong tool.
- **Python 3.14 vs editable installs**: `.pth`-based editable installs loaded
  unreliably (ModuleNotFoundError from console scripts while `python -m`
  worked). Fixes: pytest `pythonpath`, a self-bootstrapping `solver.py`
  launcher, and a hard-won "stop depending on install mechanics" lesson.
- **scp -r hauling 500 MB**: build artifacts (kernel/target 414 MB, .venv,
  runs/) dwarfed the 76 source files (<1 MB). tar-over-ssh with excludes: one
  second. Runbook updated.
- **The disk-full 3am crash**: overnight fine-bucket run died mid-checkpoint.
  Root cause was an onion: the AMI's 8.6 GB filesystem had never been grown
  into the 30 GB partition; EBS modify has a 6-hour cooldown between
  modifications; solution was attaching a fresh 150 GB volume (no cooldown on
  new volumes) and symlinking the runs dir. Atomic checkpoint saves meant
  ~20 minutes of training lost, nothing more. Runner patched to refuse
  export-on-full-disk with a helpful message.
- **Throughput decay is real**: MCCFR slows as strategies sharpen (fewer
  instant folds → deeper traversals) — from 12.5k it/s to ~3k sustained on
  the laptop. Not a bug; now documented so nobody panics at the dashboard.

## Compute story

| Stage | Hardware | Result |
|---|---|---|
| Bench | 2020 i5 MBP (4c) | 10.4k it/s burst, ~3k sustained (thermal) |
| Bench | c7i.8xlarge (32 vCPU spot) | **101k it/s** — ~30× the laptop sustained |
| Run 1 (200 buckets) | ~2h EC2 | 636M iterations, 8 depths, Δ<0.02, 13.8M infosets |
| Run 2 "best" (600 buckets, richer menus) | overnight EC2 | **844M iterations**, Δ<0.01 everywhere (0.0071–0.0097) |

Run 2's config: two preflop opens (2.5x/3.5x), two 3-bet sizes, three flop
sizes, overbets from 60bb, 600 E[HS] buckets/street, 128-sample bucketing.
Total cloud spend for the whole project: roughly ten dollars.

## What got built (the deliverables)

- `solver-kernel` (Rust): CFR+/MCCFR trainer with sharded concurrent store,
  checkpoint/resume, probe-based convergence metric, EV extraction pass,
  SQLite export, jam/fold exact solver, bucket builder, bench.
- `tilted_solver` (Python): artifact reader; spot mapper with geometric
  action translation; exact knapsack with shadow-price and temperature knobs;
  advisor CLI producing full cart recommendations with solo-GTO vs
  budget-adjusted annotations; coupled-round self-play harness; training
  runner (smoke / time-boxed / until-converged presets, live rich table,
  `solver status`, honest extrapolated ETAs); EC2 bootstrap + runbook.
- **The Solver Lab** (FastAPI + vanilla JS): strategy explorer (13×13
  preflop grids, postflop bucket strips, EV tooltips); turn composer; quiz
  trainer with EV-loss grading (chess-style, because GTO answers are mixed
  strategies — binary right/wrong would train you *worse*) including the
  Tilted-native full-turn allocation quiz; and **play-vs-solver** — full
  match play against the blueprint, styled with Tilted's Classic Premium
  design tokens (felt, gold, cream card faces), persistent stacks, effective-
  depth strategy switching as stacks swing, bust-ends-match.

## Honest limitations (also blog material)

- Convergence is *within the abstraction* — not a low-exploitability
  certificate for unabstracted NLHE. That ceiling was chosen deliberately.
- E[HS] bucketing is blind to hand *potential* (a flush draw and a weak pair
  can share a bucket). A human who hammers draws exploits this. Fix would be
  distribution-aware bucketing — a code change, not a config change.
- The convergence probe is dominated by high-traffic nodes; rare deep lines
  are proportionally less trained. The play bot announces "off-book" rather
  than guessing silently.
- Layer 2 captures the budget coupling exactly but the informational
  coupling (allocation-as-tell) only via noise-sampling. The coupled game
  remains unsolved — by anyone.
- First 23 hands against the run-1 bot: human +10.6 bb/hand. Lesson included
  free of charge: 23 hands of heads-up is not a sample size; one all-in
  double-up is ±200bb.

## The through-line

Every step had a falsifiable gate before the next: toy games with known
values → published Nash charts → conformance pinning → self-play controls →
convergence deltas. When something looked wrong (CFR rates, negative
exploitability, winning too easily), the instrumentation existed to say
*which* explanation was true. That discipline — not the poker — is probably
the transferable story.

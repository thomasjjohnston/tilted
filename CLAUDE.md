# CLAUDE.md — Guide for Claude Code working on Tilted

This file tells Claude Code (and any coding agent) how to do high-quality work in this repo. Read it before every session.

## 1. What Tilted is (in 3 sentences)

Tilted is a heads-up Texas Hold'em iPhone game for a small group of friends where ten hands run in parallel off one shared chip stack per match. It's explicitly experimental — rules are expected to change as the users play. As of the SIWA / multi-user expansion, any Apple-signed user can challenge any other signed-up user; per-pair matches run concurrently.

## 2. Required reading before writing code

Read in this order on every new session. Don't skip. These are the spec:

1. `resources/product-definition-mvp.md` — product truth. If there's ever a conflict with code, the spec wins unless the spec is being explicitly changed in the same PR.
2. `docs/HLD.md` — architecture, data model, invariants.
3. `docs/SPRINT-PLAN.md` — ordered work, story by story.
4. `resources/mockups.html` — visual source of truth for iOS screens. Open in a browser when working on any view.

If the spec is ambiguous on a point you need: **stop and ask**. Do not guess. The product owner (TJ) treats rule ambiguities as bugs in the spec, not in the code.

## 3. Repo shape

```
tilted/
├── CLAUDE.md                  # this file
├── docs/
│   ├── HLD.md
│   └── SPRINT-PLAN.md
├── resources/
│   ├── product-definition-mvp.md
│   └── mockups.html
├── apps/
│   ├── server/                # Node 20 + TypeScript + Fastify + Drizzle
│   └── ios/                   # SwiftUI, iOS 17+
├── pnpm-workspace.yaml
└── package.json
```

If any of these directories don't exist yet, you're likely working in Sprint 0 and should create them as the plan dictates.

## 4. The golden rules of this codebase

These are non-negotiable. Violating any of them is a PR-blocker.

### 4.1 Server is the source of truth for game state

The iOS client never computes game outcomes. It displays server state and collects user intent. Every bet size, every fold, every winner is decided server-side. Client-side validation exists purely as UX (snapping the slider, disabling illegal buttons) — the server re-validates on every request and its answer is final.

### 4.2 Pure core, imperative shell

Code in `apps/server/src/engine/` must be pure: no database, no logging, no clock, no network. Given the same inputs, it returns the same output every time. All side effects live in `apps/server/src/game/` and `apps/server/src/db/`. This separation is what makes the poker rules testable.

If you find yourself adding `await db.…` inside `engine/`, stop. That code belongs in `game/`.

### 4.3 Every mutation is transactional

Every endpoint that changes state opens a transaction, does `SELECT … FOR UPDATE` on the relevant `matches` row, performs all mutations, and commits. No partial writes. No "I'll update that in the next request." See HLD §6.

Use Drizzle's `db.transaction(async (tx) => { ... })`. Pass `tx` explicitly through every helper — don't let repos read from a module-scoped `db` inside a transaction.

### 4.4 The chip ledger invariant is sacred

For each user, at every commit: `Σ reserved_per_active_hand ≤ user.total_chips`. Enforce it three ways (see HLD §8):
1. Pre-action validation in `ledger.ts` refuses illegal actions.
2. Post-mutation assertion inside the same transaction aborts if violated.
3. Nightly job re-verifies every active match.

If a test fails because the invariant fires, **do not weaken the invariant**. Find the bug in the mutation.

### 4.5 Idempotency is mandatory

Every state-mutating endpoint accepts a `client_tx_id` from the caller. Deduplicate on it server-side (unique constraint on `(hand_id, client_tx_id)` for actions). A retry with the same id returns the original result, not a 4xx.

### 4.6 No client-side secrets

Deck seeds, opponent hole cards, and any `action_on_user_id` information are filtered server-side before serialization. Every endpoint builds a user-scoped response. There is a unit test for every endpoint asserting that the opponent's hole cards are NOT in the JSON when they shouldn't be. Never remove that assertion.

### 4.7 Rules change; code is cheap

The product is explicitly experimental. Design every feature so a rule change (blind sizes, hand count per round, chip starting stack) is a one-file edit. Hardcode nothing across multiple files. If you need a constant in three places, put it in one module and import.

### 4.8 User identity is Sign in with Apple (production); debug picker stays for local dev

Release builds authenticate via Sign in with Apple — the server verifies identity tokens against Apple's JWKS and issues a bearer. DEBUG builds still show the 2-user PIN picker (`DebugPickerView`) so engineers can iterate without an Apple modal on every launch. `USER_TJ_ID` / `USER_SL_ID` survive only as DEBUG conveniences in `db/seed.ts` and `APIModels.swift` — server code never references them.

### 4.9 Matches are per-pair

Any authenticated user can challenge any other. The `matches_one_active_idx` invariant is gone: multiple pairs can have active matches concurrently. The application-level check is "at most one active match per (userA, userB) pair, in either ordering" — enforced in `createMatch`.

## 5. Workflow: one sprint, one story at a time

1. Before starting: re-read the sprint in `docs/SPRINT-PLAN.md`. Identify the story you're about to tackle.
2. Create a branch: `git checkout -b sprint-N/<story-id>-<short-slug>` (e.g., `sprint-2/s2-3-action-application`).
3. **Write the test first** for anything in `engine/`, `game/`, `api/`, or the iOS model/store layer. Property-based tests are welcomed for the engine.
4. Implement the minimum to pass. Refactor.
5. Update docs in the same PR if behavior diverges from `HLD.md` or the spec.
6. Run the full test suite locally. `pnpm -r test` for server; `xcodebuild test` for iOS.
7. Open a PR. Link the sprint story id in the title (e.g., `[S2-3] Apply action + turn handoff`).
8. One story = one PR. Do not batch unrelated stories.

## 6. Commit and PR conventions

- **Commit subject**: imperative, under 70 chars. Prefix with the story id in brackets: `[S1-3] Add betting street state machine`.
- **Commit body**: the "why," not the "what." Link to the sprint story and any spec sections relevant. 2–5 sentences is the norm.
- **PRs**: include a short "What I tested" section and screenshots for any iOS change.
- **Small PRs win.** <400 lines of diff is the default target. If a story needs more, split it.
- **Never force-push to `main`.** `main` is protected; merges are squash-merges.

## 7. Testing discipline

### Server

- `engine/` — 100% unit test coverage target. Property-based where feasible (fast-check). Every §17 spec edge case gets a named test.
- `game/` — integration tests against an ephemeral Postgres (docker or Testcontainers). Walk real matches end-to-end.
- `api/` — Fastify `inject()` for fast endpoint tests. Verify authz, idempotency, and redaction on every endpoint.
- **Never mock Postgres.** If you catch yourself reaching for a DB mock, use a real ephemeral DB instead.

### iOS

- XCTest for models / store / action-queue logic.
- SwiftUI Previews for every screen with representative mock data. Previews are reviewed in PRs as the visual contract.
- Snapshot tests only where a screen is intentionally pixel-stable (Home, Round Summary).

### Cross-cutting

- The invariant-regression fuzzer (Sprint 6, S6-3) runs in CI on every PR against the server.
- Manual test notes go in the PR description. "I played two rounds locally with the CLI and observed X" is a first-class test report.

## 8. Specific implementation guidance (the stuff that bites)

- **`SELECT FOR UPDATE`** is cheap, so use it. For every mutating request, lock the `matches` row first. This serializes conflicting writes without needing a distributed lock.
- **Drizzle transactions**: pass `tx` to every helper; don't use module-scoped `db` inside a `db.transaction(async (tx) => ...)` block, or you'll silently run queries outside the tx.
- **Turn handoff** (HLD §7): insert into `turn_handoffs` inside the transaction; fire APNS **after** commit using a post-commit hook, keyed on the `handoff_id` for dedupe. Never fire APNS inside the transaction — if the commit is rolled back, the push has already happened.
- **APNS**: use the HTTP/2 JWT auth flow. Generate a deterministic push id from `handoff_id` so retries are safe.
- **Deck seed**: persist on the hand row. Cards are derived from the seed deterministically but also snapshotted (`user_a_hole`, `user_b_hole`, `board`) — reads use the snapshot, the seed is for debugging and forensics.
- **Zod** is the single source of truth for request schemas. Derive TypeScript types from zod, not the other way around.
- **SwiftUI state**: prefer `@Observable` over `@ObservableObject`. One `AppStore` is enough for MVP — no TCA, no Redux.
- **APIClient**: one `async throws` method per endpoint. Generate idempotency UUIDs inside the method, not at the call site, unless the caller needs retry semantics (action submission does).
- **Refresh model**: pull on foreground, launch, post-action, APNS tap, pull-to-refresh. No timers. No WebSockets.

## 9. What NOT to do

- Do not introduce Redis, Kafka, a message queue, or a second service. The spec does not need them and neither does the code.
- Do not add a caching layer. Postgres is fast enough for two users.
- Do not write mocks for Postgres or APNS in server tests. Use ephemeral Postgres; use an APNS test double that records calls.
- Do not add new third-party iOS dependencies without discussing. SwiftUI + URLSession + Keychain + APNS is the full ingredient list.
- Do not add analytics SDKs. The `app_events` table is the analytics plane.
- Do not implement rules client-side beyond pure UX affordances (slider clamping, "after this bet" readout). Every such computation must also exist server-side and server wins.
- Do not use `git push --force` on any shared branch.
- Do not touch production data with the admin CLI. Prefix destructive commands with a `--yes-i-know-production` guard.

## 10. When the spec is ambiguous

Order of operations:

1. Re-read the relevant spec section and §17 (edge cases).
2. Search for any clarifying example in the mockups.
3. If still ambiguous, **add a comment in the PR and stop**. Ask TJ. Do not ship a guess.
4. If the clarification should live in the spec, update `resources/product-definition-mvp.md` in the same PR that implements it.

## 11. Ops essentials (repeat to yourself)

- Production lives on Fly.io in one region. Deploy = push to `main`.
- Postgres is Fly-managed; connection string in Fly secrets.
- APNS key + team id + bundle id in Fly secrets.
- Rollback = `fly deploy --image <previous-image-sha>`. Practice this at least once.
- Watch logs with `fly logs`.

## 12. Definition of Done (shared with human engineers)

A story is done only when all of these are true:

- Code reviewed and approved by at least one other engineer.
- Unit tests for pure code; integration tests for any endpoint that mutates state.
- `pnpm -r lint typecheck test` clean. iOS build clean, no warnings.
- Spec updated if behavior diverged from `resources/product-definition-mvp.md` or `docs/HLD.md`.
- PR description lists what was tested manually (for iOS stories, include a simulator screenshot or video).
- Story id linked in the commit and PR title.

---

*This file is the canonical guide for automated coding agents on Tilted. Keep it updated as patterns emerge — a pattern you had to re-learn is a pattern worth adding here.*

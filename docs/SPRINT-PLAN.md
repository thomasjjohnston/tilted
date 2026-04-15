# Tilted — Sprint Plan (MVP)

**Status:** Draft v0.1 — pairs with `docs/HLD.md`
**Team:** 3 engineers
**Sprint length:** 2 weeks
**Total target:** 6 sprints → ~12 weeks to TestFlight-with-TJ-and-friend

---

## Team roles (shorthand used below)

- **S** — Server lead. Owns `engine/`, `game/`, `api/`, database, invariants.
- **I** — iOS lead. Owns the SwiftUI app, APNS integration on-device, screens.
- **F** — Full-stack / infra. Owns CI/CD, Fly, APNS server-side, admin CLI, cross-cutting. Floats between server and iOS as needed.

These are leads, not silos — everyone reviews everyone's PRs. **F in particular** is the swing engineer — expect them to sink 30–50% into whichever side is behind in a given sprint.

## Global Definition of Done (applies to every story)

- Code reviewed by at least one other engineer.
- Unit tests for pure functions; integration tests for endpoints that mutate state.
- No warnings in `tsc --noEmit`, `eslint`, `swiftlint`.
- Runs against a fresh dev DB via `pnpm dev` (server) and the current iOS simulator build (client).
- PR description includes what was tested manually.
- For any rule change: `docs/HLD.md` and/or `resources/product-definition-mvp.md` updated in the same PR.

---

## Sprint 0 — Foundations (Weeks 1–2)

**Goal:** Every engineer can ship a trivial change end-to-end. Nothing of product value yet.

**Sprint demo:** "Hello Tilted" — the iOS app, running on a TestFlight build on TJ's phone, pings the production Fly server and shows the response.

### Stories

**S0-1 — Repo scaffold (F, 1 day)**
- Monorepo at `github.com/thomasjjohnston/tilted`: `apps/server`, `apps/ios`, `docs/`, `resources/`.
- pnpm workspaces, shared `tsconfig.base.json`, root README with setup instructions.
- Acceptance: fresh clone → `pnpm install && pnpm test` runs and passes for an empty server.

**S0-2 — Server skeleton (S, 2 days)**
- Fastify 5 + TypeScript + zod. Single route: `GET /healthz` → `{ ok: true, commit: <git_sha> }`.
- Structured JSON logging (pino). Env loading via `dotenv`.
- Dockerfile; runs locally with `docker compose up` (server + Postgres).
- Acceptance: `curl localhost:3000/healthz` returns 200.

**S0-3 — Postgres + Drizzle (S, 2 days)**
- Drizzle ORM + Drizzle Kit. Migration pipeline wired: `pnpm db:generate`, `pnpm db:migrate`.
- First migration: creates `users` table.
- Acceptance: server boots against Postgres, can `select * from users` on boot and log count.

**S0-4 — Fly deployment pipeline (F, 2 days)**
- Fly app `tilted-server` in a single region.
- Managed Postgres (Fly Postgres cluster, smallest tier).
- Secrets management for `DATABASE_URL`, `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`.
- Deploy on `main` merge via GitHub Actions.
- Acceptance: pushing to `main` results in a deploy; `https://tilted-server.fly.dev/healthz` returns 200.

**S0-5 — iOS project scaffold (I, 2 days)**
- New SwiftUI Xcode project, iOS 17+ target, bundle id `com.thomasjjohnston.tilted`.
- `APIClient.swift` with `URLSession` + async/await, base URL from build config (staging = dev laptop, prod = Fly).
- Single screen: tap button → GET `/healthz` → display response.
- Acceptance: app runs in simulator and on TJ's phone, fetches from Fly.

**S0-6 — TestFlight + Apple Developer provisioning (I + F, 2 days)**
- Apple Developer account enrolled (if not already); App ID registered; APNS key generated and uploaded to Fly secrets.
- Internal TestFlight group with TJ + friend.
- First TestFlight build uploaded (the healthz-pinging app).
- Acceptance: TJ and friend each have the app installed via TestFlight.

**S0-7 — Debug picker auth (S + I, 3 days)**
- Server: seed two user rows on migration. Route `POST /v1/auth/debug/select { user_id } → { token }`. Token table `debug_tokens (token_hash, user_id, created_at)`. Middleware enforces bearer on all `/v1/*` routes except `/v1/auth/*`.
- iOS: `DebugPickerView` shown on first launch if no token in Keychain; picking a user calls the endpoint and stashes the token.
- Acceptance: picking TJ on launch yields a token that authenticates subsequent requests; `GET /v1/me` returns `{ display_name: "TJ" }`.

**S0-8 — GitHub Actions CI (F, 1 day)**
- Server: lint, typecheck, test.
- iOS: build for simulator, run unit tests.
- Required for merge.
- Acceptance: failing test blocks merge.

### End-of-sprint state

Two users authenticated against a deployed Fly server from TestFlight builds. No game logic yet.

---

## Sprint 1 — Poker engine (Weeks 3–4)

**Goal:** A pure, fully-tested poker engine. No UI, no database writes. If we got hit by a bus here, someone else could build Tilted on top of this library.

**Sprint demo:** A CLI that plays a heads-up hand against itself with random actions and prints the action log + winner. No Postgres, no iOS.

### Stories

**S1-1 — Deterministic deck (S, 2 days)**
- `engine/deck.ts`: seeded PRNG (xoroshiro128**), shuffle, deal N cards.
- Property-based tests: same seed → same deal.

**S1-2 — Card + hand evaluator (S, 1 day)**
- Thin wrapper around `pokersolver`. `evaluate(holeCards, board): HandRank`. `compare(a, b): -1 | 0 | 1`.
- Tests using known showdown scenarios from published heads-up poker problems.

**S1-3 — Betting street state machine (S, 4 days)**
- `engine/streets.ts`: represents a single hand's betting.
- Inputs: player positions (SB/BB), stacks, board, action history.
- Output: `legalActions(state, actor) → Action[]`, `apply(state, action) → state'`.
- Rules: preflop SB acts first, postflop BB acts first, min-raise, all-in short-call rules, street closes when both acted & bets equal.
- Extensive tests: every §17 edge case gets a test name.

**S1-4 — Showdown resolver (S, 1 day)**
- `engine/showdown.ts`: winner or split; apply HU odd-chip-to-OOP rule.

**S1-5 — Engine CLI harness (F, 2 days)**
- `pnpm engine:self-play` — runs a single hand with random legal actions, prints narration.
- No database. Just exercises the engine.
- Acceptance: 100 self-play runs finish without exceptions; showdowns resolve.

**S1-6 — iOS — build HomeView shell (I, 4 days)**
- Static `HomeView` matching mockup 04 (no active match) and 05 (your turn) with **stubbed** data.
- Design tokens captured: colors, type, spacing as Swift constants matching HLD §13 / mockups §01.
- Reusable `PlayingCard` view and `ChipStack` view.
- Acceptance: both Home states are visually reviewable in SwiftUI Preview.

**S1-7 — iOS — networking models (I, 2 days)**
- Codable DTOs for the anticipated API: `MatchState`, `RoundState`, `HandView`, `Action`. Based on HLD §9.
- Unit tests: decode known JSON fixtures.

**S1-8 — Admin CLI v0 (F, 2 days)**
- `pnpm cli` with: `seed-users`, `list-users`, `reset-users`. (Match/hand commands come next sprint.)

### End-of-sprint state

Server can simulate heads-up poker in pure functions. iOS has the Home screen looking right against stubbed data. Nothing is wired together yet.

---

## Sprint 2 — Parallel rounds & chip ledger (Weeks 5–6)

**Goal:** The hard half of the backend — 10 hands in parallel, shared stack, turn handoff — persisted correctly in Postgres. Client reads but doesn't act yet.

**Sprint demo:** Using the admin CLI, open a match, advance through a scripted 10-hand round with synthetic actions, and watch the iOS HomeView live-update its "N hands awaiting your action" pill (via app foreground pull).

### Stories

**S2-1 — Full schema + migrations (S, 2 days)**
- All tables from HLD §5: `matches`, `rounds`, `hands`, `actions`, `favorites`, `turn_handoffs`, `app_events`.
- Drizzle schema + migrations committed.
- Repository modules: `repos/match.ts`, `repos/round.ts`, `repos/hand.ts`, `repos/action.ts`.

**S2-2 — Match / round / hand lifecycle (S, 4 days)**
- `game/match.ts`: `createMatch(userA, userB)`, `endMatch(matchId, winner)`, coin-flip for round-1 SB.
- `game/round.ts`: `openRound(matchId)` — deals 10 hands atomically, posts blinds to reserved, sets `action_on_user_id` to SB for each, sets status `in_progress`.
- `game/hand.ts`: `dealStreet(handId, street)` using the hand's `deck_seed`.
- All mutations wrapped in a transaction with `SELECT ... FOR UPDATE` on `match`.

**S2-3 — Action application + turn handoff (S, 4 days)**
- `game/turn.ts`: `applyAction(handId, userId, action, clientTxId)`.
- Validates using `engine/streets.ts`. Updates `actions`, `hands`, `matches` (chip totals on hand completion), inserts `turn_handoffs` row when handoff occurs.
- Idempotent per `client_tx_id`.
- Emits `app_events` rows.
- Integration tests: walk a full 10-hand round against an ephemeral Postgres (docker).

**S2-4 — Chip ledger invariant job (F, 2 days)**
- Function `verifyLedger(matchId)`: sums reserved across hands and checks against totals.
- Called post-commit in dev; scheduled nightly Fly Machine in prod.
- Alerts to a shared channel (Slack webhook or email) on violation.

**S2-5 — `GET /v1/match/current` + `GET /v1/match/:id/round/current` (S, 3 days)**
- User-scoped. Redacts opponent's hole cards. Computes pending counts. Returns exactly the shape in HLD §9.
- Integration tests verify redaction.

**S2-6 — Admin CLI v1 (F, 2 days)**
- `new-match`, `dump-match <id>`, `force-action <hand> <user> <type> [amount]`, `advance-round <match>`, `reset-match`.
- Acceptance: from the CLI we can play a full deterministic round end-to-end.

**S2-7 — iOS wires HomeView to real data (I, 4 days)**
- `AppStore` refreshes from `/v1/match/current` on foreground / app-launch / pull-to-refresh.
- Renders correct Home state based on `status` + pending counts.
- "Start new match" button posts `POST /v1/match`.
- No TurnView yet; tapping "Take your turn" shows a placeholder.
- Acceptance: using the CLI to script a round, iOS HomeView reflects match state & opponent info accurately.

**S2-8 — iOS — coin flip animation (I, 2 days)**
- Matches mockup 08. Small win: wiring the first "delightful moment" animation early de-risks the reveal work in Sprint 4.

### End-of-sprint state

A match can be fully played via the admin CLI. iOS shows correct state but can't take actions yet. This is the hardest sprint — if we nail this, the rest is user-facing polish.

---

## Sprint 3 — Turn flow (Weeks 7–8)

**Goal:** A real player can take their turn on iOS. End-to-end: open app → see pending hands → fold/call/bet in each → submit → opponent gets APNS.

**Sprint demo:** TJ and friend play a real round against each other on their phones, over lunch. No reveal polish yet — all-in hands just show "awaiting runout" placeholder at round end.

### Stories

**S3-1 — `POST /v1/hand/:id/action` (S, 3 days)**
- Thin Fastify wrapper over `game/turn.applyAction`.
- zod-validated request body.
- Returns the post-action hand state + round-level turn-state update so the client can decide what to show next.
- Idempotency via `client_tx_id`.

**S3-2 — Bet legality preview endpoint (S, 1 day)**
- `GET /v1/hand/:id/legal-actions` → `{ min_raise, max_bet, available_after_min_raise, available_after_max_bet, ... }`.
- Client uses this to drive the bet slider without reimplementing the math.

**S3-3 — iOS TurnView (I, 5 days)**
- Scrollable `LazyVStack` of `HandCardView`s, one per pending hand.
- Sticky header with "X of 10 hands left."
- Auto-scroll to next pending hand on action.
- Terminal or waiting-on-opponent hands collapsed + greyed.
- Matches mockups 09, 10.

**S3-4 — iOS BetSheet (I, 4 days)**
- Modal bottom sheet with ½-pot / ⅔-pot / pot / all-in quick buttons, slider (clamped to server-provided min/max), +/- 10-chip increments, "after this bet you will have X available" readout.
- Matches mockup 11.

**S3-5 — iOS all-in confirmation (I, 1 day)**
- Separate sheet per mockup 12; taps `POST /v1/hand/:id/action` only after explicit confirm.

**S3-6 — iOS turn-submitted screen (I, 1 day)**
- Full-screen confirmation after last pending hand is acted on (mockup 13).
- Returns to HomeView on tap.

**S3-7 — APNS on turn handoff (F, 3 days)**
- Server: APNS client (node-apn or apple-apn-http2), keyed by `APNS_KEY`. On each new `turn_handoffs` row, post-commit dispatch.
- Deterministic push id from `handoff_id` for dedupe.
- Payload: `{ alert: {opponent} finished…, N hands waiting, category: TURN_HANDOFF, match_id, round_id }`.
- iOS: register for remote notifications; on permission grant, `POST /v1/me/apns-token`; on tap, deep-link to TurnView.
- Acceptance: TJ acts on all pending hands → friend's phone buzzes within 5s.

**S3-8 — Per-action retry logic (I, 1 day)**
- `APIClient` retries 3× with jittered backoff on network errors, always reusing the same `client_tx_id` per intended action.

### End-of-sprint state

Two real humans can play a full 10-hand round with only the bare-minimum reveal. Everything the spec calls "the core async-parallel loop" works.

---

## Sprint 4 — Reveal & hand history surfaces (Weeks 9–10)

**Goal:** Round reveal theater + every hand has a delightful summary card + detailed replay. This sprint is where the "memorable hand" product pillar becomes real.

**Sprint demo:** Play a round that includes one preflop jam all-in and one check-call river. Watch the reveal animation at round end. Tap the jam hand from the feed. Replay it step-by-step. Favorite it.

### Stories

**S4-1 — Round reveal data path (S, 2 days)**
- When round transitions to `revealing`, in the same transaction deal any remaining community cards for `awaiting_runout` hands and flip them to `complete` with full board persisted.
- New endpoint `POST /v1/round/:id/advance` — idempotent; moves round to `complete` after reveal; creates next round.

**S4-2 — iOS RevealView (I, 5 days)**
- Sequential reveal: each frozen all-in hand shown in turn, 2–3s per, with card-flip animation (`.matchedGeometryEffect`), pot→winner text.
- Round summary at end (mockup 16) with net chips won/lost.
- "Next round" CTA calls `POST /v1/round/:id/advance`.
- Matches mockups 14, 15, 16.

**S4-3 — Hand summary endpoint (S, 1 day)**
- `GET /v1/hand/:id` returns full hand detail: board, both hole cards (if not folded pre-reveal), pot, winner, full `actions[]` with timestamps, pot_after at each step.

**S4-4 — iOS HandSummaryCard + in-feed listing (I, 3 days)**
- Compact tile per mockup 17.
- Shown on HomeView below the main CTA; shows last N completed hands.
- Favorite star toggle.

**S4-5 — iOS DetailedReplayView (I, 4 days)**
- Scrubber, step-by-step action log, street separators with board reveal at correct moment, relative timestamps.
- Designed to be screenshot-friendly (high contrast, all key data visible).
- Matches mockup 18.

**S4-6 — Favorites endpoint (S, 1 day)**
- `POST /v1/hand/:id/favorite { favorite: bool }` → 204.
- `app_events` row emitted.

**S4-7 — iOS action sketch generator (F, 2 days)**
- Given an `actions[]` list + winner, produce the one-line summary ("SB raised, BB 3-bet, SB called; flop checked, turn jam called — BB wins 420").
- Unit tests against known scenarios.

### End-of-sprint state

The "reminisce" loop is real. A hand someone wants to talk about is findable, viewable, and shareable via iOS screenshot.

---

## Sprint 5 — History, polish, notifications (Weeks 11–12)

**Goal:** Fill in the remaining surfaces and make the app feel finished.

**Sprint demo:** TJ scrolls through every match he's played with friend, filters to favorites, taps through a replay. The settings screen works. The app behaves well on bad network.

### Stories

**S5-1 — History endpoint (S, 2 days)**
- `GET /v1/match/:id/history?favorites=true&won=lost|won|all&round=N` — paginated, default sort recent-first.
- Cross-match history at `GET /v1/history?...`.

**S5-2 — iOS HistoryView (I, 4 days)**
- List + filter pills (All / Favorites, Won / Lost / All, By-match).
- Matches mockups 19, 20.

**S5-3 — Match-end flows (I, 2 days)**
- "You won" / "You lost" screens (mockups 21, 22). Triggered when match status flips to `ended` on fetch.
- Shows match summary; CTA to start new match.

**S5-4 — Settings screen (I, 1 day)**
- Notification toggle (invokes iOS settings deep link if denied), sign-out / reset-match (dev), version string, feedback email button (mailto: TJ).

**S5-5 — Background fetch + deep-linking polish (I, 2 days)**
- Ensure a cold-start from APNS tap lands in TurnView correctly.
- Handle app-launched-while-opponent-acted: HomeView refresh on foreground always.

**S5-6 — Event log polish (F, 1 day)**
- All §18 events emitted reliably: turn_submitted, hand_completed, round_completed, match_ended, favorite_added, app_session_started.
- Add `app_events`-based "daily digest" SQL snippet in the admin CLI.

**S5-7 — Offline / network-error UX (I, 3 days)**
- Retries on transient errors; banner when offline; action submission gracefully defers until reconnect.
- No UI regressions when switching airplane mode mid-turn.

**S5-8 — Push-notification deep link end-to-end test (F, 1 day)**
- Script: force a turn handoff; assert APNS dispatched; simulate tap via URL scheme; iOS lands on TurnView.

### End-of-sprint state

Feature-complete per the MVP spec. Nothing feels stubbed.

---

## Sprint 6 — Hardening & release (Weeks 13–14)

**Goal:** Burn down edge cases. TestFlight build stable enough for two-week daily-play campaign.

**Sprint demo:** Show the §17 edge-case test matrix all green. Hand TJ + friend the build.

### Stories

**S6-1 — §17 edge-case test matrix (S, 4 days)**
- One automated test per bullet: both fold, preflop SB fold, simultaneous connection loss, slider past min-raise, chopped pots + odd-chip, running out of chips mid-round, jam hand 1 for 2000 before other SB posts, opponent's live stack visibility, action immutability after submit.
- Each test's name echoes the spec bullet verbatim.

**S6-2 — Connection-loss / retry hardening (S + I, 3 days)**
- Drop packets mid-action; reopen app; verify state is consistent and retry is safe.
- Action submitted but server response lost → iOS retry with same `client_tx_id` yields same result.

**S6-3 — Invariant regression harness (S, 2 days)**
- A seed-based self-play fuzzer that plays N random matches and asserts ledger invariant after every action. Runs in CI on every PR.

**S6-4 — Performance pass (F, 2 days)**
- Profile top 5 endpoints under 10× realistic load (10 concurrent synthetic players). All under 150ms P95.
- Measure iOS cold-start to HomeView-rendered. Target <1.5s on TJ's phone.

**S6-5 — UI polish pass (I, 3 days)**
- Haptics on critical actions (fold confirm, bet submit, all-in, reveal moments).
- Dark-mode sanity check.
- Real typography audit against mockups.

**S6-6 — Dev notes + operational runbook (F, 1 day)**
- `docs/OPERATIONS.md`: how to reset a stuck match, how to read logs, how to roll back a deploy, how to rotate APNS keys.

**S6-7 — Two-week playthrough (whole team, in parallel with above)**
- TJ + friend use the app daily from Sprint 6 day 1.
- Bugs logged in GitHub Issues; triage daily.
- Exit criterion per §19: both users voluntarily initiated ≥1 new match after first bust, ≥10 hands favorited total, both can articulate one memorable hand without looking at the app.

### End-of-sprint state

MVP meets §19 success criteria and the rules-change feedback pipeline is active.

---

## Parallelization map

Each sprint has an implied dependency shape. The critical path is mostly through S (server):

```
S0 ── S1 ────── S2 ──── S3 ──── S4 ──── S5 ──── S6      (server track)
         \          \        \                            
          I-shell    I-home   I-turn ─── I-reveal ── I-history
                                                        \
                                                         F-polish
```

**Rules for allocation inside a sprint:**
- S should always be one endpoint ahead of I. If S is blocked, they should be working on next sprint's schema or the invariant job.
- I should never block waiting for an API — F stubs the endpoint with a static JSON fixture within hours so I can proceed.
- F is the swing engineer — if one of S or I is behind by >2 days, F floats.

## Out-of-scope for MVP (explicitly deferred)

All of the §2 non-goals remain out of scope. In addition, post-MVP-first-slot:
1. Real auth (Sign in with Apple).
2. Round-reveal polish pass (chip animations, confetti).
3. Feature flag system (for rule experimentation).
4. Web admin dashboard.
5. Same-size-to-all bet quick-apply.
6. In-app comments / reactions.
7. Deadlines + auto-actions on turns.

## Risks specific to the sprint plan

| Risk | Probability | Trigger | Response |
|---|---|---|---|
| Engine work slips in Sprint 1 | Medium | Street state-machine proves trickier than estimated | F pulls in and pairs; slip S2 one sprint if needed. |
| Reveal animation turns into a rabbit hole | Medium | Sprint 4 week 1 ends without a working reveal | Fall back to static per-hand-card reveal; ship polish in a patch. |
| Apple Developer / TestFlight provisioning delays | Medium | Any single step of S0-6 takes more than 2 days | F escalates; meanwhile use simulator-only for dev. |
| Rule change mid-sprint from TJ | High | Product feedback after real play | Changes target the `engine/` module; `admin/reset-match` unblocks in-flight matches. |

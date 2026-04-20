# Tilted — Project State

**Read this doc before starting work on a fresh session.** It captures what's built, what's live, decisions that are locked in, and quirks learned the hard way.

Pair this with `CLAUDE.md` (golden rules), `docs/HLD.md` (architecture), `docs/SPRINT-PLAN.md` (original plan), and `resources/product-definition-mvp.md` (spec).

Latest feature spec: **`docs/BETA-FEEDBACK-IMPLEMENTATION-SPEC.md`** — read this for the next batch of work.

---

## 1. Live deployment

| Thing | Value |
|---|---|
| Server URL | `https://tilted-server.fly.dev` |
| Health check | `https://tilted-server.fly.dev/healthz` |
| Fly app | `tilted-server` |
| Database | Neon Postgres (connection string in Fly secrets as `DATABASE_URL`) |
| iOS | TestFlight build; installed on TJ's + Stephen's phones |
| Bundle ID | `com.thomasjjohnston.tilted` |
| Apple Dev account | Enrolled (TJ has paid dev program) |

### Commands that matter

```bash
# Server deploy
fly deploy --app tilted-server

# Server logs
fly logs --app tilted-server

# Reset active match (local or remote via DATABASE_URL)
cd apps/server && pnpm cli reset-match

# Seed users (idempotent)
cd apps/server && pnpm cli seed-users

# Regenerate Xcode project (after project.yml edits)
cd apps/ios/Tilted && xcodegen generate

# Server tests (84 passing)
cd apps/server && pnpm test
```

---

## 2. Auth model

**Release builds: Sign in with Apple.**
- `POST /v1/auth/apple` takes an `identity_token` (+ optional `full_name` / `email` on first sign-in).
- Server verifies the JWT against Apple's JWKS, upserts by `apple_sub`, returns a bearer token (same `debug_tokens` table as before).
- iOS `SignInView` uses `SignInWithAppleButton` and requests `.fullName + .email` scopes.
- Sign in with Apple capability must be enabled on the App ID in Apple Developer portal — enabled as of 2026-04-20.

**DEBUG builds: legacy PIN picker kept for local dev.**
```
Thomas Johnston (TJ)
  user_id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  PIN:     8989

Stephen Layton (SL)
  user_id: b2c3d4e5-f6a7-8901-bcde-f12345678901
  PIN:     1234
```
Only accessible when `#if DEBUG` in `RootView` (Xcode Run, not Archive/TestFlight). These user rows in prod DB will be orphaned once everyone logs in via SIWA — harmless, can be cleaned up later.

**Account deletion.** `DELETE /v1/me` + a Settings → Delete Account button are in place (App Store guideline 5.1.1(v)). Server-to-server revocation webhook at `POST /v1/auth/apple/notifications` — functional but requires a Service ID configured in Apple Developer before Apple actually POSTs to it.

**Sarah Flint was renamed to Stephen Layton** mid-session. Don't bring her back.

---

## 3. Locked-in design decisions

These are NOT up for debate without explicit user revisit:

### Chip display: "available-first"
- Primary number is always `available` (chips you can bet with right now)
- `total` is secondary context, shown smaller
- `reserved` shown as "in play"
- The Match-up page uses Big Blinds (BB) for pot sizes, not raw chips, because blinds will be configurable.

### Navigation
- **Bottom tab bar** (not single-screen with covers): Home, Match-up, History, Settings
- Turn, Reveal, CoinFlip stay as `fullScreenCover` from Home
- `showHistory` and `showSettings` covers should be removed from HomeView — replaced by tabs

### Hand completion UX
- **Center Stage cinematic** for every resolved hand (not just all-ins)
- Card flip animation for opponent reveal
- Clear winner line: "Two Pair beats Pair of Queens"
- Bookmark (star) button on result screen
- Tap to continue (no auto-dismiss)
- Mucking rules preserved: folded cards shown as placeholder, never revealed

### Transitions
- **Dual-footer pattern**: `[↑ All Hands]` and `[Next Hand →]` at the bottom of the result screen
- Next Hand disabled when no more pending
- Auto-act batch should NOT fire the result screen per-hand — only the turn summary

### Match-up page
- Layout: **Stacked Sections** (Option 01 from `resources/matchup-options-v2.html`)
- Scoreboard hero → Moments → H2H bars → Pinned hands grid
- Pinned hands = user's favorites, surfaced on Match-up with auto-detected tags (cooler, bad beat, etc.)
- Poker moment detection is approximate, not exact equity math. Rules of thumb only.

### Notifications
- 4 triggers: `match_started`, `turn_handoff`, `round_complete`, `match_ended`
- 6h reminder if turn is still pending (single reminder, not daily)
- No quiet hours, no per-type toggles
- Deep-link on tap to the relevant screen

---

## 4. What's done vs what's next

### ✅ Shipped (in `main` via merged PRs)
- All 6 sprints of original MVP spec
- Poker engine (deck, evaluator, streets, showdown) — 90 tests passing
- Full game layer (match, round, turn, ledger, favorites, history)
- REST API with bearer auth, zod validation
- Bottom tab bar (Home / Match-up / History / Settings) + `MatchUpView` (scoreboard, H2H, moments, pinned hands)
- Center-stage `ShowdownResultView` for every hand completion (showdown, fold, split)
- Dual-footer on result screen (↑ All Hands / Next Hand →) with handoff plumbing
- APNS pushes (HTTP/2 via `node:http2`, IEEE-P1363 JWT, UUID apns-id dedupe) — 4 triggers wired
- 6h reminder scanner (in-process `setInterval`, fires while machine is running)
- Sign in with Apple (JWKS verifier, `POST /v1/auth/apple`, iOS `SignInView`, debug picker DEBUG-only)
- Multi-user / multi-match support (matches are per-pair; `matches_one_active_idx` dropped)
- Account deletion (`DELETE /v1/me` + Settings button, required by App Store guidelines)
- Apple revocation webhook endpoint (functional; Apple Dev Service ID config pending)
- Fly + Neon deployment, TestFlight 0.1.4+

### 📋 Specified but NOT implemented
- iOS filter pill for "history vs. specific opponent" — server supports it
  (`/v1/history?opponent_user_id=...`), the UI segmented control doesn't
  yet add the pill. One-hour job when desired.

### 🕳 Known gaps / deferred
- No offline UI (we gracefully degrade but don't show a banner).
- No accessibility pass (default iOS only).
- No analytics dashboard — `app_events` table is populated but never queried in UI.
- CI on iOS side fails (`.xcodeproj` gitignored, `xcodegen` in CI needs tweaking).
- Apple revocation webhook: code is live but Apple won't POST until a Service ID is created in the Developer portal and configured to call our endpoint.
- Legacy TJ/SL user rows exist in prod DB without `apple_sub`. They'll be orphaned once both users sign in via SIWA. Safe to leave or clean up later.

---

## 5. Quirks learned the hard way

### Server
- **Fastify 5 plugin encapsulation**: `addHook` inside a plugin only applies to routes registered inside that same plugin. Solution: `debugAuthRoutes` + `bearerAuth` exported separately, `app.addHook('onRequest', bearerAuth)` inside a nested `app.register(async (authed) => ...)` scope. This is in `app.ts` — don't refactor it back.
- **Drizzle return shape**: `db.query.table.findFirst` returns camelCase. Raw `sql\`\`` / `tx.execute` returns snake_case. Mixing them bit us — prefer `db.query` wherever possible.
- **Ambiguous column errors**: joining `hands` and `rounds` in raw SQL requires table aliases because both have `round_id`. See `ledger.ts` for the pattern.
- **Chip settlement bug pattern**: when settling a hand, update BOTH players' totals: `new_total = old_total - reserved + award`. Award is 0 for the loser. The early bug only updated the winner and chips inflated.
- **All-in awaiting_runout**: if EITHER player is all-in when a street closes, hand goes to `awaiting_runout`, not the next street. Don't deal more cards that no one can act on.
- **pino-pretty**: must be installed as devDep. Without it, dev server crashes on startup.

### iOS
- **SwiftUI `.task` cancellation**: if the parent view's presentation binding re-evaluates, the sheet's `.task` is cancelled and throws `CancellationError`. Pattern: capture state (e.g. `match`/`round`) into `@State` before the async work, so re-renders don't interrupt it. See `RevealView` for the fix.
- **Optimistic update**: `MatchState.currentRound` and `RoundView.hands` need to be `var`, not `let`. We mutate them locally on action to get instant UI.
- **`sheet(item:)` with String ID**: doesn't work directly — need an `IdentifiableString` wrapper struct.
- **`ActiveScreen` enum with associated values**: must conform to `Equatable` manually (or the compiler synthesizes it if all cases are comparable).
- **Fastify route returns snake_case, iOS models use camelCase**: always use `CodingKeys` to map. Forgetting this causes silent decode failures.
- **xcodegen**: the `.xcodeproj` is gitignored — regenerate with `xcodegen generate` after any `project.yml` change. Also after adding Swift files in new subdirectories, regen is required.
- **Apple Distribution signing identity**: don't hardcode in `project.yml`. Let Xcode pick `Apple Development` automatically. Archive signing uses a different identity.
- **App Transport Security**: to allow local HTTP in DEBUG builds, we set `INFOPLIST_KEY_NSAppTransportSecurity_AllowsArbitraryLoads: true`. For production, only HTTPS (Fly) is hit, but the flag is still on.

### Networking
- **iOS DEBUG base URL**: was pointing at local IP (`http://10.0.0.30:3000`) for home-WiFi testing. Now hardcoded to Fly. If future work needs local dev again, gate with a different compile flag.
- **Docker port conflict**: 5432 was already used by another project locally — we moved Tilted's local Postgres to 5433. The production Neon connection is port 5432 (standard).

---

## 6. Open questions for TJ (not blockers)

- Should the pinned-hands limit be fixed (e.g. top 8 by pot size) or does the user curate?
- For auto-detected "cooler" and "bad beat" tags, is the heuristic good enough, or do we want actual equity-based detection (more accurate, more expensive)?
- 6h reminder: should the second reminder happen at all, or is 1 push + 1 reminder enough?
- Match-up tab: does showing real stats require enough history to be interesting? If the rivalry is 2 matches in, the page looks sparse. Empty-state design TBD.

---

## 7. How to verify the server is healthy

```bash
# 1. Health check
curl -s https://tilted-server.fly.dev/healthz
# → {"ok":true,"commit":"..."}

# 2. Auth + match state (uses TJ's user_id)
TOKEN=$(curl -s -X POST https://tilted-server.fly.dev/v1/auth/debug/select \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890"}' | jq -r .token)

curl -s https://tilted-server.fly.dev/v1/match/current \
  -H "Authorization: Bearer $TOKEN" | jq '.my_total + .opponent_total'
# → 4000 (chip conservation invariant)
```

If that chip sum is NOT 4000, the chip ledger is broken. Reset the match and investigate.

---

## 8. File layout quick reference

```
apps/server/src/
  engine/      — pure poker logic (no I/O). 84 tests here.
  game/        — transactional orchestration
  api/         — Fastify routes (auth + domain)
  db/          — Drizzle schema + connection
  notif/       — APNS dispatch (currently stubbed in prod)
  events/      — app_events logger
  admin/       — CLI tools: pnpm cli <cmd>

apps/ios/Tilted/Tilted/
  App/         — @main, design tokens
  Networking/  — APIClient, models
  Store/       — @Observable AppStore
  Views/
    Home/      — HomeView, CoinFlipView
    Turn/      — TurnView, ShowdownResultView, TurnSummaryView, BetSheet
    Reveal/    — RevealView (all-in cinematic)
    History/   — HistoryView, HandDetailView
    Settings/  — SettingsView
    DebugPicker/ — PIN login
  Components/  — PlayingCardView, AvatarView, ChipBadgeView, ButtonStyles
  Push/        — PushRegistrar
  Persistence/ — KeychainHelper

docs/
  HLD.md                                — architecture
  SPRINT-PLAN.md                        — original plan
  PROJECT-STATE.md                      — THIS FILE
  BETA-FEEDBACK-IMPLEMENTATION-SPEC.md  — beta feedback work (shipped)
  SIWA-MULTIUSER-SPEC.md                — SIWA + multi-user work (shipped)
  TURN-VIEW-REDESIGN.md                 — v1 redesign (historical)
  HAND-COMPLETION-SPEC.md               — v1 hand completion (historical)

resources/
  product-definition-mvp.md        — product truth
  mockups.html                     — original Classic Premium mockups
  matchup-options-v2.html          — approved: Option 01 (Stacked Sections)
  hand-ending-options-v2.html      — approved: Options 01/02 (Center Stage)
  transition-options-v2.html       — approved: Option 01 (Dual Footer)
  *-options.html (v1)              — historical explorations
```

---

## 9. Tests that must stay green

Every PR should pass these:

```bash
cd apps/server
pnpm lint
pnpm typecheck
pnpm test              # 90 tests — if you add features, add tests, don't subtract
```

The invariant fuzzer (`test/engine/fuzzer.test.ts`) asserts chip conservation. If a chip math change breaks it, you broke the ledger. Don't weaken the test.

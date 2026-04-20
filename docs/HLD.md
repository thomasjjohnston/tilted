# Tilted — High-Level Design

**Status:** Draft v0.1 — pairs with `resources/product-definition-mvp.md`
**Audience:** Engineering, pre-sprint planning
**Companion docs (to be produced):** `SPRINT-PLAN.md`

---

## 1. Shape of the system (one-paragraph version)

Tilted is, architecturally, a turn-based board game played over HTTP. A single authoritative **server** owns the game state, enforces the rules, persists everything to **Postgres**, and fires an **APNS** push when it's the other player's turn. The **SwiftUI iOS client** is a thin view layer: it renders server state, collects actions, and revalidates nothing it cannot trust. There is no real-time component in the game-physics sense — all state transitions are discrete, player-initiated HTTP calls, and everything else is animation or polling.

The two genuinely interesting problems — and the places we'll invest most of our engineering calories — are (a) the **shared-stack chip ledger invariant** (`Σ reserved_per_hand ≤ total_chips`) and (b) the **turn-handoff state machine** across 10 parallel hands. Neither is distributed-systems-hard, but both are detail-hard. They are good candidates for strong testing.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| iOS client | Swift 5.10+, SwiftUI, iOS 17+ | iOS-only target; SwiftUI's declarative model and animation primitives (`.matchedGeometryEffect`, transitions, `@Observable`) fit the hand-card list and reveal theater naturally. |
| Networking (iOS) | `URLSession` + async/await + Codable, `swift-collections` | No third-party HTTP lib needed; REST + JSON is enough. |
| Persistence (iOS) | SwiftData or a small `UserDefaults`/Keychain setup | Only needed for auth token + last-seen-state cache. No local game state — server is source of truth. |
| Push | APNS via `UNUserNotificationCenter`, server-side using JWT auth tokens (p8 key) | Native. No third-party push provider. |
| Server | Node 20, TypeScript, Fastify 5, `zod` for schema validation | Fast iteration on rule changes; TS gives us enough safety for invariants with zero compile-deploy latency. |
| DB | Postgres 16 (Fly managed or Neon) | Transactional state machine; `SELECT ... FOR UPDATE` on the `match` row is our concurrency primitive. |
| DB access | Drizzle ORM + Drizzle Kit | Typed schema-as-code, auto-generated migrations, plays well with raw SQL escape hatches for `SELECT ... FOR UPDATE`. |
| Poker eval | `pokersolver` (npm) + our own dealer/state-machine | The solver is well-tested and tiny; we don't need to reinvent hand ranking. |
| Hosting | Fly.io, single app, single region | One small machine + managed Postgres. Cost is pocket change for two users. |
| CI | GitHub Actions | Lint, typecheck, test, deploy on `main` merge. |
| Observability | Fly logs + a `app_events` table + `/admin/*` read-only routes | "Minimal event logging" (§18). Metabase if we want dashboards later. |
| Dev tooling | A small `pnpm cli` command: `reset-match`, `dump-match`, `replay-hand`, `grant-chips`, `force-advance` | Lets us debug without opening the DB. |

## 3. Component view

```
┌──────────────────────┐      HTTPS (REST + JSON)         ┌──────────────────────────┐
│  iOS app (SwiftUI)   │  ─────────────────────────────▶ │  Tilted server (Fastify)  │
│                      │  ◀─────────────────────────────  │                          │
│  • HomeView          │                                   │  /api  Fastify routes     │
│  • TurnView          │                                   │  /engine  pure rules     │
│  • BetSheet          │                                   │  /game    orchestration  │
│  • RevealView        │                                   │  /notif   APNS dispatch  │
│  • ReplayView        │                                   │  /events  event logging  │
│  • HistoryView       │                                   │  /db      repos + tx     │
│                      │  ◀───── APNS push ─────────────  │                          │
└──────────────────────┘                                   └────────────┬─────────────┘
                                                                        │
                                                                        ▼
                                                              ┌───────────────────┐
                                                              │  Postgres 16      │
                                                              │  (Fly managed)    │
                                                              └───────────────────┘
```

Everything server-side runs in a single Node process. No microservices. No Redis. No message queue. We can introduce those exactly when we need them — almost certainly never for this product's lifetime at two users.

## 4. Server module layout

The server is organized around a **pure core + imperative shell** pattern. This is the single most important decision in the server design: it makes the rules of poker testable without a database and makes the chip ledger testable without Apple Push.

```
apps/server/
  src/
    api/              # Fastify routes, auth, request/response shapes (zod)
    game/             # orchestration: transactions, invariants, turn handoff
      match.ts
      round.ts
      hand.ts
      turn.ts         # the "whose turn is it?" computation
      ledger.ts       # reserved/available accounting
    engine/           # PURE, no I/O
      deck.ts         # seeded PRNG, deterministic deal
      evaluator.ts    # thin wrapper over pokersolver
      streets.ts      # preflop/flop/turn/river progression + legal actions
      showdown.ts     # winner determination + split rules
    notif/            # APNS client, idempotent dispatch
    events/           # insert into app_events
    db/               # drizzle schema, migrations, repositories
    admin/            # CLI: reset-match, dump-match, replay-hand, etc.
    http.ts           # fastify bootstrap
  test/
    engine/           # hundreds of unit tests — property-based where useful
    game/             # integration tests against an ephemeral postgres
    api/              # end-to-end tests (supertest)
```

## 5. Data model

The spec's §14 sketch is close. Refinements:

```sql
-- users (2 rows, ever, for MVP)
create table users (
  user_id       uuid primary key,
  display_name  text not null,
  apns_token    text,
  created_at    timestamptz not null default now()
);

-- matches: "current" is expressed via status='active'; invariant enforced in app layer
create table matches (
  match_id        uuid primary key,
  user_a_id       uuid not null references users,
  user_b_id       uuid not null references users,
  starting_stack  int  not null default 2000,
  blind_small     int  not null default 5,
  blind_big       int  not null default 10,
  status          text not null check (status in ('active','ended')),
  winner_user_id  uuid references users,
  sb_of_round_1   uuid not null references users,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  -- derived totals updated transactionally on every hand completion
  user_a_total    int  not null,
  user_b_total    int  not null
);
-- NOTE: The original MVP had `create unique index on matches (status) where
-- status = 'active'` to enforce "exactly one active match globally." That
-- index was dropped in migration 0003 when the app expanded to N users;
-- now multiple pairs can have active matches concurrently. The
-- application-level rule is "at most one active match per (userA, userB)
-- pair, in either ordering" — enforced in `createMatch`.

create table rounds (
  round_id       uuid primary key,
  match_id       uuid not null references matches,
  round_index    int  not null,
  sb_user_id     uuid not null references users,
  bb_user_id     uuid not null references users,
  status         text not null check (status in ('dealing','in_progress','revealing','complete')),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  unique (match_id, round_index)
);

create table hands (
  hand_id           uuid primary key,
  round_id          uuid not null references rounds,
  hand_index        int  not null check (hand_index between 0 and 9),
  deck_seed         text not null,                    -- for debug/reproducibility
  user_a_hole       jsonb not null,                   -- ['Ah','Kd']  -- nullable-visible-client-side only
  user_b_hole       jsonb not null,
  board             jsonb not null default '[]'::jsonb,
  pot               int  not null default 0,
  user_a_reserved   int  not null default 0,          -- chips A has in this hand's pot
  user_b_reserved   int  not null default 0,
  street            text not null check (street in ('preflop','flop','turn','river','showdown','complete')),
  action_on_user_id uuid references users,            -- null once hand is terminal
  status            text not null check (status in ('in_progress','awaiting_runout','complete')),
  terminal_reason   text check (terminal_reason in ('fold','showdown') or terminal_reason is null),
  winner_user_id    uuid references users,
  completed_at      timestamptz,
  unique (round_id, hand_index)
);

create table actions (
  action_id         uuid primary key,
  hand_id           uuid not null references hands,
  street            text not null,
  acting_user_id    uuid not null references users,
  action_type       text not null check (action_type in ('fold','check','call','bet','raise','all_in')),
  amount            int  not null default 0,
  pot_after         int  not null,
  client_tx_id      text not null,                    -- idempotency
  client_sent_at    timestamptz,
  server_recorded_at timestamptz not null default now(),
  unique (hand_id, client_tx_id)
);

create table favorites (
  user_id     uuid not null references users,
  hand_id     uuid not null references hands,
  created_at  timestamptz not null default now(),
  primary key (user_id, hand_id)
);

-- denormalized notification idempotency ledger
create table turn_handoffs (
  handoff_id     uuid primary key,
  round_id       uuid not null references rounds,
  from_user_id   uuid not null references users,
  to_user_id     uuid not null references users,
  fired_at       timestamptz not null default now()
);

create table app_events (
  event_id    uuid primary key,
  user_id     uuid references users,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
```

Notes:

- `user_a_id`/`user_b_id` is a stable labeling (a < b alphabetically); it's fine for two-player. We don't use "seat 0/1" semantics.
- `hands.action_on_user_id` is a denormalized field, kept in sync inside the same transaction that advances the hand. It is the **primary index used by the turn view**.
- `user_a_reserved` + `user_b_reserved` on `hands` makes the chip ledger cheap to query. Invariant check: `Σ over active hands per user ≤ users.total - sum(winnings) + initial`.
- The `client_tx_id` unique index gives us per-action idempotency: a retry from iOS with the same txid is a no-op and returns the prior result.
- The `unique index where status='active'` on `matches` is how we enforce §4's "one match at a time for MVP" without app-layer races.

## 6. Concurrency & consistency

Two users can, in principle, both hit the server at the same time. In practice they cannot both be the acting player (only one is on turn), but they can race on, e.g., one player submitting actions while the other reads state, or a retry colliding with a subsequent action.

Our model:

- Every **mutating** request starts with `BEGIN; SELECT * FROM matches WHERE match_id = $1 FOR UPDATE;`. This serializes all mutations for a given match behind the match row. Reads are MVCC and don't block.
- **Read** requests (home view, turn view, history) use snapshot reads without `FOR UPDATE`. Eventual-consistency within a single request is fine because we snapshot at query start.
- **Idempotency** is provided by `actions.client_tx_id UNIQUE (hand_id, client_tx_id)`. The iOS client generates a UUID per intended action and retries with the same id on network errors.
- **APNS dispatch** is idempotent via `turn_handoffs`: we write a row in the same transaction that resolves a turn, and the post-commit hook dispatches the push once per row. A `to_user_id, round_id, ordinal` unique constraint would make us robust to crashes between commit and push (future work; not MVP-critical).

## 7. The turn state machine

The turn is the central UX primitive. Here's the precise server-side formulation.

**Inputs at any moment:** for each hand in the current round, either it's terminal, it's awaiting_runout, or it has `action_on_user_id = A` or `= B`.

**Derived turn state:**

```
let aPending = count of hands where action_on_user_id = A and hand is in_progress
let bPending = count of hands where action_on_user_id = B and hand is in_progress

if aPending > 0 and bPending == 0 → "A's turn"
if bPending > 0 and aPending == 0 → "B's turn"
if aPending == 0 and bPending == 0 → "round ready to reveal/advance"
if aPending > 0 and bPending > 0   → impossible (invariant violation)
```

**Applying an action:**

1. Open transaction, `SELECT ... FOR UPDATE` the match.
2. Reload the hand. Verify `action_on_user_id = acting_user_id` and the action is legal given `street`, `pot`, and the acting user's `available_chips`.
3. Mutate:
   - Fold → `status=complete, terminal_reason=fold, winner=opponent, action_on_user_id=null, pot→winner`
   - Check → advance street if street closes; else `action_on_user_id = opponent`
   - Call → equalize bet; advance street if street closes; else opponent
   - Bet/Raise → update `pot`, update `user_x_reserved`, `action_on_user_id = opponent`
   - All-in → same as bet, but if both now all-in, `status=awaiting_runout, action_on_user_id=null`
4. If the hand is still in progress on a new street, deal the community cards for that street (from the stored deck_seed).
5. Recompute `aPending/bPending` for the round.
6. If both are zero → move round to `revealing` and enqueue `round_reveal` (next fetch by either client will receive the reveal state and perform the runout).
7. If acting player's pending count is now zero and opponent's is > 0 → insert a `turn_handoffs` row.
8. Commit.
9. Post-commit: for any `turn_handoffs` written, dispatch APNS.

This logic lives in `game/turn.ts` and is test-covered by (a) unit tests on the rule transitions and (b) integration tests that spin up a real ephemeral Postgres and walk a scripted match.

## 8. Chip ledger invariant

The money rule:

> At every commit, for each user, `users.total_chips >= sum(user_x_reserved) over all active hands in all active rounds`.

We enforce it three ways:

1. **Before-action validation** in `ledger.ts`: compute available = `total - Σ reserved`, refuse any action exceeding it.
2. **Transactional constraint check** after mutation: re-query the sum and assert against total. If the invariant is violated, abort the transaction.
3. **A nightly job** (trivial cron Fly Machine) that runs the invariant query across all matches and alerts on any violation. This is cheap insurance while rules are churning.

`users.total_chips` is updated only at hand resolution: winner's `total += pot`, loser's `total -= loser_reserved_in_this_hand`. (Equivalent formulation: winner's reserved in that hand returns + they gain the loser's reserved.)

## 9. API surface (sketch)

REST, JSON, bearer-token auth. All responses are user-scoped — the server redacts the opponent's hole cards before serializing.

```
POST   /v1/auth/debug/select        body: { user_id }  → { token }   # debug picker
GET    /v1/me                        → user

GET    /v1/match/current             → MatchState | null
POST   /v1/match                     → MatchState                     # start new match (if neither has active)

GET    /v1/match/:id/round/current   → RoundState + hands[] (filtered per user)
GET    /v1/match/:id/history         ?favorites=true&won=true&round=N  → Hand[]

POST   /v1/hand/:id/action           body: { type, amount?, client_tx_id }
                                     → ActionResult { hand, round_turn_state }
POST   /v1/hand/:id/favorite         body: { favorite: boolean }
GET    /v1/hand/:id                  → full hand detail incl. actions[]

POST   /v1/round/:id/advance         → RoundState                    # "Next round" button
```

**`MatchState` shape (shorthand):**

```ts
{
  match_id, opponent: { user_id, display_name },
  my_total, opponent_total,
  my_reserved, opponent_reserved,
  my_available, opponent_available,
  current_round: {
    round_id, round_index, status, my_role: 'sb' | 'bb',
    hands_pending_me: number, hands_pending_opponent: number,
    hands: HandView[]
  }
}
```

## 10. Client architecture (SwiftUI)

```
TiltedApp/
  App/                         # @main, DI, root view
  Networking/
    APIClient.swift            # async/await, bearer auth, retries
    Endpoints.swift
    Models/                    # Codable DTOs that mirror the server's JSON
  Store/
    AppStore.swift             # @Observable; holds current Match/Round/Hand state
    Refresh.swift              # on-foreground pull; post-action pull
  Views/
    HomeView.swift
    TurnView/
      TurnView.swift           # scrollable hand-card list
      HandCardView.swift
      BetSheet.swift
      AllInConfirm.swift
    Reveal/
      ReveieView.swift         # sequential runout
      RoundSummary.swift
    History/
      HistoryView.swift
      HandDetail.swift
      ReplayView.swift
    Settings/
      SettingsView.swift
    DebugPicker/
      DebugPickerView.swift
  Push/
    PushRegistrar.swift        # APNS registration + APNS-token-upload
    PushHandler.swift          # routes taps to TurnView
  Persistence/
    Keychain.swift             # bearer token
  Components/
    Card.swift                 # reusable card rendering primitive
    Chips.swift                # stack counter w/ animated change
```

The store is a simple `@Observable` class; for MVP we don't need Redux/TCA. We re-fetch on: app foreground, app launch, after any action, on APNS arrival, and pull-to-refresh.

## 11. Authentication (MVP)

- On first launch, show a 2-item debug picker ("TJ" / "Friend"). Selection persists.
- Client calls `POST /v1/auth/debug/select` with the selected user_id. Server returns a long-lived bearer token, stored in Keychain. Server side, the token is a random 256-bit string indexed in a `debug_tokens` table (`token_hash, user_id, created_at`).
- All subsequent requests carry `Authorization: Bearer <token>`.
- **Not secure** — it's explicitly throwaway per §15. Replace with Sign in with Apple post-MVP.

## 12. Notifications

- On install / accept-permission, iOS posts the device token to `POST /v1/me/apns-token`.
- Server persists on `users.apns_token`.
- On every `turn_handoffs` row insert, the notif module fires an APNS push with `alert: "{opponent} finished their turn. N hands are waiting for you."`, `category: TURN_HANDOFF`, deep-link payload `{match_id, round_id}`.
- Tap → deep link to `TurnView`. If the app was backgrounded, it foreground-refreshes automatically.
- Dedupe: APNS is best-effort, but Apple delivers once per push id. We generate the push id deterministically from `turn_handoffs.handoff_id`.

## 13. Reveal & replay

- When a round transitions to `revealing`, the server computes all remaining community cards (for any `awaiting_runout` hands) inside the round-advance transaction. Hands become `status=complete` with full `board` persisted.
- Client fetches the round; any hand marked `revealed_at_round_end = true` is rendered with the full sequential reveal animation (SwiftUI `.transition(.opacity.combined(with: .scale))` on each card + matchedGeometryEffect for card flips).
- Replay view reads `actions` + `hand` for any hand, renders a scrubber. All state needed to reconstruct the replay is in those two tables.
- We deliberately do not animate pot movement in MVP — a clear "Winner: TJ +420" text is enough and avoids a meaningful animation investment before we have feedback.

## 14. Observability & dev tooling

- **Logs**: structured JSON to stdout, Fly aggregates.
- **Events**: every interesting transition writes to `app_events` (turn_submitted, hand_completed, round_completed, match_ended, favorite_added, app_session_started). Query with `psql` for MVP.
- **Admin CLI** (`pnpm cli <cmd>` from a local laptop against Fly Postgres):
  - `reset-match` — mark all active matches ended; zero stacks; ready for new match.
  - `dump-match <match_id>` — full JSON dump incl. hands + actions.
  - `replay-hand <hand_id>` — prints action-by-action log for inspection.
  - `grant-chips <user> <amount>` — for testing edge cases.
  - `force-advance-round <round_id>` — unblock a stuck round in dev.

## 15. Testing strategy

| Layer | Test style | Target coverage |
|---|---|---|
| `engine/` | Unit, property-based for betting legality and evaluator | 100% of code paths; invariants asserted |
| `game/` | Integration vs. ephemeral Postgres (docker) | All flows in §7 walked end-to-end |
| `api/` | supertest against an in-memory Fastify + ephemeral pg | Happy paths + authz + idempotency |
| iOS views | `XCTest` + `Preview`-driven snapshot tests for key screens | Mostly previews; lean |
| iOS model/store | `XCTest` | Action-queueing, refresh logic |
| Push | manual; one automated smoke test against APNS sandbox | Keeps us from breaking the pipe |

## 16. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| iOS inexperience on the team leads to animation rabbit holes | Slips Sprint 4 | Keep reveal simple per our choice; allocate half a day of prototyping before committing |
| Rule changes require data migration mid-MVP (e.g., blinds 5/10 → 10/20) | Breaks in-flight matches | Start every rule-change with `reset-match`; blind values live in `matches`, so already snapshotted per-match |
| Shared-stack invariant violated by a subtle bug | Monetarily irrelevant (no real money) but the game breaks | Triple-layered defense (§8); nightly invariant job alerts |
| APNS provisioning drags | Blocks Sprint 5 polish | Have a team member own Apple Developer setup from Sprint 0 day 1 |
| TestFlight provisioning for TJ + friend | Blocks end-user testing | Internal TestFlight only needs TJ's dev account; enroll in Sprint 0 |
| Rules ambiguity during Sprint 1 | Blocks engine work | Engineer pairs with TJ on each ambiguity in real time; use `resources/product-definition-mvp.md` as the only spec |

## 17. What this HLD deliberately does not do

- **No caching layer.** Two users, Postgres handles every read easily.
- **No message queue / event bus.** No need.
- **No microservices.** Every module is in-process.
- **No WebSockets.** The product is explicitly async.
- **No iOS local game logic beyond UX affordances.** Server is the only source of truth.
- **No analytics SaaS.** An events table + SQL covers the "is anyone favoriting" question.
- **No feature flags / remote config.** Rules change in code; redeploy is seconds on Fly.

## 18. Open questions for next pass

- Do we want a web admin read-only dashboard by the end of MVP, or is the CLI enough? (Current plan: CLI only; revisit if it's painful by Sprint 5.)
- Do we need end-to-end encryption between clients and server beyond TLS? (Current plan: no; nothing sensitive in transit.)
- Replay's "relative timestamps" (§12): do we show wall-clock latency or game-time elapsed? (Current plan: wall-clock in the detail view, coarsely formatted — "4h", "2m".)
- Per-hand comments / reactions: confirmed deferred post-MVP.

# Beta Feedback Implementation Spec

**Status:** Approved, ready for implementation.
**Scope:** Four features driven by beta feedback. Implement in this order — each builds on the previous.

**Picks recap:**
- **Notifications**: All 4 triggers, 6h reminder, no quiet hours, no settings toggles.
- **Match-up page**: Option 01 (Stacked Sections — Scoreboard + Moments + H2H + Pinned Hands), bottom tab bar.
- **Hand endings**: Center-stage Option 01/02 from hand-ending-options-v2.html — extend to fire for ALL resolved hands, not just all-ins.
- **Transitions**: Option 01 (Dual Footer — permanent "↑ All Hands" + "Next Hand →" buttons at the bottom of the detail sheet, visible both before and after action).

---

## 0. Global Changes (do first)

### 0.1 Tab bar navigation

The app currently uses `HomeView` as root with `fullScreenCover` for each screen. To support the new Match-up tab, convert the root to `TabView`.

**File: `apps/ios/Tilted/Tilted/App/TiltedApp.swift`**

Change `RootView` from conditional `HomeView` / `DebugPickerView` to:

```swift
struct RootView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        Group {
            if store.isAuthenticated {
                MainTabView()
            } else {
                DebugPickerView()
            }
        }
        .preferredColorScheme(.dark)
        .onAppear { store.checkAuth() }
    }
}

struct MainTabView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Image(systemName: "house.fill")
                    Text("Home")
                }
            MatchUpView()
                .tabItem {
                    Image(systemName: "person.2.fill")
                    Text("Match-up")
                }
            HistoryView()
                .tabItem {
                    Image(systemName: "clock.fill")
                    Text("History")
                }
            SettingsView()
                .tabItem {
                    Image(systemName: "gearshape.fill")
                    Text("Settings")
                }
        }
        .tint(.gold500)
    }
}
```

**Tab bar styling**: Set `UITabBar` appearance in `TiltedApp.init()`:

```swift
init() {
    let appearance = UITabBarAppearance()
    appearance.configureWithOpaqueBackground()
    appearance.backgroundColor = UIColor(Color.felt800.opacity(0.95))
    appearance.stackedLayoutAppearance.normal.iconColor = UIColor(Color.cream300)
    appearance.stackedLayoutAppearance.normal.titleTextAttributes = [
        .foregroundColor: UIColor(Color.cream300)
    ]
    appearance.stackedLayoutAppearance.selected.iconColor = UIColor(Color.gold500)
    appearance.stackedLayoutAppearance.selected.titleTextAttributes = [
        .foregroundColor: UIColor(Color.gold500)
    ]
    UITabBar.appearance().standardAppearance = appearance
    UITabBar.appearance().scrollEdgeAppearance = appearance
}
```

**Remove `activeScreen` navigation from HomeView:**
The existing `HistoryView()` and `SettingsView()` fullScreenCovers on HomeView become redundant — remove them. `HomeView`'s buttons for "History" and "Settings" should be removed (users use the tab bar now). Keep the Turn, Reveal, and CoinFlip fullScreenCovers — those remain modal presentations from Home.

---

## 1. Notifications (Server + iOS)

### 1.1 Server: APNS secrets + real push dispatch

**Existing:** `apps/server/src/notif/apns.ts` has an APNS client that is a no-op when `APNS_KEY` is empty. The `dispatchPush` function is already called from `turn.ts` on turn handoff.

**Required work:**

1. **Apple Developer portal setup** (one-time, outside code):
   - Create an APNS Auth Key (.p8 file) for the app bundle `com.thomasjjohnston.tilted`.
   - Record: Key ID (10-char string), Team ID (10-char string), Bundle ID.

2. **Fly.io secrets** (one-time):
   ```bash
   fly secrets set \
     APNS_KEY="$(cat AuthKey_XXXXXX.p8)" \
     APNS_KEY_ID="ABCDEFGHIJ" \
     APNS_TEAM_ID="0123456789" \
     APNS_BUNDLE_ID="com.thomasjjohnston.tilted" \
     --app tilted-server
   ```

3. **iOS: register for remote notifications**

   **File: `apps/ios/Tilted/Tilted/App/TiltedApp.swift`**

   Wire up the existing `PushRegistrar`:

   ```swift
   @main
   struct TiltedApp: App {
       @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
       @State private var store = AppStore()

       var body: some Scene {
           WindowGroup {
               RootView()
                   .environment(store)
                   .task {
                       await PushRegistrar.shared.requestPermission()
                   }
           }
       }
   }

   class AppDelegate: NSObject, UIApplicationDelegate {
       func application(_ application: UIApplication,
                        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
           PushRegistrar.shared.handleDeviceToken(deviceToken)
       }
       func application(_ application: UIApplication,
                        didFailToRegisterForRemoteNotificationsWithError error: Error) {
           print("APNS registration failed: \(error)")
       }
   }
   ```

   `PushRegistrar` already calls `APIClient.shared.updateApnsToken(tokenString)` on receipt. No changes needed there.

### 1.2 Server: Four notification triggers

Add a `notif.ts` dispatcher with four payload types. Update triggers across the game layer.

**File: new `apps/server/src/notif/dispatchers.ts`**

```ts
import { eq } from 'drizzle-orm';
import { users, matches } from '../db/schema.js';
import type { Database, Transaction } from '../db/connection.js';
import { sendApnsPush } from './apns.js';

export type NotifKind =
  | 'match_started'
  | 'turn_handoff'
  | 'round_complete'
  | 'match_ended';

interface NotifInput {
  kind: NotifKind;
  toUserId: string;
  fromUserId: string; // opponent
  matchId: string;
  roundId?: string;
  roundIndex?: number;
  handsPending?: number;
  allInCount?: number;
  winnerUserId?: string;
  dedupeKey: string; // used as apns-id for idempotent retries
}

export async function dispatch(db: Database | Transaction, n: NotifInput) {
  const toUser = await db.query.users.findFirst({ where: eq(users.userId, n.toUserId) });
  const fromUser = await db.query.users.findFirst({ where: eq(users.userId, n.fromUserId) });
  if (!toUser?.apnsToken || !fromUser) return;

  const opponentName = fromUser.displayName.split(' ')[0];

  let title = 'Tilted';
  let body = '';
  let category = 'GENERIC';
  const payload: Record<string, unknown> = {
    match_id: n.matchId,
    kind: n.kind,
  };

  switch (n.kind) {
    case 'match_started':
      body = `New match! ${opponentName} dealt round 1 — 10 hands waiting.`;
      category = 'MATCH_STARTED';
      payload.round_id = n.roundId;
      break;
    case 'turn_handoff':
      body = `${opponentName} finished their turn. ${n.handsPending} hand${n.handsPending === 1 ? '' : 's'} await you.`;
      category = 'TURN_HANDOFF';
      payload.round_id = n.roundId;
      break;
    case 'round_complete':
      body = `Round ${n.roundIndex} complete! ${n.allInCount} all-in hand${n.allInCount === 1 ? '' : 's'} ready to reveal.`;
      category = 'ROUND_COMPLETE';
      payload.round_id = n.roundId;
      break;
    case 'match_ended':
      if (n.winnerUserId === n.toUserId) {
        body = `Match over — you won!`;
      } else {
        body = `Match over — ${opponentName} won.`;
      }
      category = 'MATCH_ENDED';
      break;
  }

  await sendApnsPush(toUser.apnsToken, n.dedupeKey, {
    aps: {
      alert: { title, body },
      sound: 'default',
      category,
    },
    ...payload,
  });
}
```

**Wire triggers:**

| Trigger | Where | Dedupe key |
|---|---|---|
| `match_started` | `game/match.ts` → `createMatch`, post-commit | `match-started:{matchId}` |
| `turn_handoff` | `game/turn.ts` → existing `turnHandoffs` row | `handoff:{handoffId}` (already deterministic) |
| `round_complete` | `game/turn.ts` → when round transitions to `revealing` | `round-complete:{roundId}` |
| `match_ended` | `game/round.ts` → `advanceRound` when `endMatch` fires | `match-ended:{matchId}` |

For `match_started`:
- The opponent (not the requester) gets the push.
- Fire after `createMatch` commits.

For `round_complete`:
- Both players get pushes (whoever's turn ended the round should get "Watch the reveal" prompt).
- Compute `allInCount` from hands with `status === 'awaiting_runout'`.
- Fire only when round status transitions to `revealing` (guard against duplicates).

**Replace existing call in turn.ts:**
The current `dispatchPush` call should be replaced with `dispatch(db, { kind: 'turn_handoff', ... })`. Remove the old `notif/apns.ts` `dispatchPush` helper; inline the HTTP call in `sendApnsPush`.

### 1.3 Server: 6-hour reminder job

**Problem**: iOS APNS doesn't support scheduled delivery. We need a server-side cron that scans for stale turn handoffs and re-sends.

**New table: `apps/server/src/db/schema.ts`**

```ts
export const pendingReminders = pgTable('pending_reminders', {
  reminderId: uuid('reminder_id').primaryKey().defaultRandom(),
  kind: text('kind').notNull().$type<'turn_handoff' | 'match_started' | 'round_complete'>(),
  userId: uuid('user_id').notNull().references(() => users.userId),
  matchId: uuid('match_id').notNull().references(() => matches.matchId),
  roundId: uuid('round_id').references(() => rounds.roundId),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }),
  context: jsonb('context').notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Generate migration: `pnpm db:generate`.

**Enqueue on each initial push**: After dispatch succeeds, insert a row with `dueAt = now() + 6h`.

**Cron job: new `apps/server/src/notif/reminder-cron.ts`**

```ts
import { and, eq, isNull, lte } from 'drizzle-orm';
import { pendingReminders, hands, rounds, matches } from '../db/schema.js';
import { dispatch } from './dispatchers.js';
import type { Database } from '../db/connection.js';

export async function runReminders(db: Database) {
  const now = new Date();
  const due = await db.query.pendingReminders.findMany({
    where: and(isNull(pendingReminders.firedAt), lte(pendingReminders.dueAt, now)),
  });

  for (const r of due) {
    // Verify the condition is still true (e.g. turn still pending)
    const stillRelevant = await isStillRelevant(db, r);
    if (!stillRelevant) {
      await db.update(pendingReminders).set({ firedAt: now }).where(eq(pendingReminders.reminderId, r.reminderId));
      continue;
    }

    await dispatch(db, {
      kind: r.kind as any,
      toUserId: r.userId,
      fromUserId: (r.context as any).fromUserId,
      matchId: r.matchId,
      roundId: r.roundId ?? undefined,
      handsPending: (r.context as any).handsPending,
      allInCount: (r.context as any).allInCount,
      roundIndex: (r.context as any).roundIndex,
      dedupeKey: `reminder:${r.reminderId}`,
    });

    await db.update(pendingReminders).set({ firedAt: now }).where(eq(pendingReminders.reminderId, r.reminderId));
  }
}

async function isStillRelevant(db: Database, r: typeof pendingReminders.$inferSelect): Promise<boolean> {
  // Turn handoff: check if any hands still have action_on_user_id = r.userId
  if (r.kind === 'turn_handoff') {
    const roundHands = await db.query.hands.findMany({
      where: r.roundId ? eq(hands.roundId, r.roundId) : undefined,
    });
    return roundHands.some(h => h.status === 'in_progress' && h.actionOnUserId === r.userId);
  }
  // Match started: check if user has acted yet (any action by user in this match)
  if (r.kind === 'match_started') {
    // Simplest: check if match is still active and user still has pending hands
    const match = await db.query.matches.findFirst({ where: eq(matches.matchId, r.matchId) });
    if (!match || match.status !== 'active') return false;
    return true;
  }
  // Round complete: check if round status is still 'revealing'
  if (r.kind === 'round_complete') {
    const round = await db.query.rounds.findFirst({ where: eq(rounds.roundId, r.roundId!) });
    return round?.status === 'revealing';
  }
  return false;
}
```

**Fly.io machine schedule**:

Add to `fly.toml`:

```toml
[[services.scheduled]]
  schedule = "*/5 * * * *"  # every 5 min
  command = "node apps/server/dist/cli/run-reminders.js"
```

Create `apps/server/src/cli/run-reminders.ts`:

```ts
import { createDb } from '../db/connection.js';
import { env } from '../env.js';
import { runReminders } from '../notif/reminder-cron.ts';

const db = createDb(env.DATABASE_URL);
await runReminders(db);
process.exit(0);
```

Update `package.json` build to include this. Add `"cron:reminders": "tsx src/cli/run-reminders.ts"` script.

**Alternative for simpler deployment**: Use a single process that runs the cron loop internally. Add to `http.ts`:

```ts
// After server.listen()
if (env.NODE_ENV === 'production') {
  setInterval(() => { runReminders(db).catch(console.error); }, 5 * 60 * 1000);
}
```

Pick this simpler path for MVP — skip the Fly cron machine.

### 1.4 iOS: deep-link on tap

**File: `apps/ios/Tilted/Tilted/Push/PushRegistrar.swift`**

Update `didReceive response` handler:

```swift
func userNotificationCenter(_ center: UNUserNotificationCenter,
                            didReceive response: UNNotificationResponse) async {
    let userInfo = response.notification.request.content.userInfo
    guard let kind = userInfo["kind"] as? String else { return }

    // Trigger refresh so AppStore has latest data
    await MainActor.run {
        Task { await AppStore.shared?.refresh() }
    }

    // Navigate to the right tab/screen
    await MainActor.run {
        switch kind {
        case "match_started", "turn_handoff":
            // Home tab (default) — the match will be visible
            break
        case "round_complete":
            // Home tab, trigger reveal
            AppStore.shared?.pendingAction = .openReveal
        case "match_ended":
            break
        default: break
        }
    }
}
```

Add a `static weak var shared: AppStore?` to `AppStore` to support this pattern, or use a `NotificationCenter` broadcast instead. Simplest: expose a singleton reference via `@Environment` injection pattern or a global `AppStore.shared`.

---

## 2. Match-Up Page (Server + iOS)

### 2.1 Server: new endpoint `GET /v1/matchup`

Returns the full match-up data for the requesting user + their opponent (always TJ vs SL in MVP).

**File: new `apps/server/src/game/matchup.ts`**

```ts
import { eq, and, sql, desc } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { matches, rounds, hands, actions, favorites, users } from '../db/schema.js';
import { USER_TJ_ID, USER_SL_ID } from '../db/seed.js';

export interface MatchUpView {
  you: UserSummary;
  opponent: UserSummary;
  scoreboard: Scoreboard;
  moments: Moment[];
  head_to_head: HeadToHead;
  pinned_hands: PinnedHand[];
}

interface UserSummary {
  user_id: string;
  display_name: string;
  initials: string;
}

interface Scoreboard {
  matches_won_you: number;
  matches_won_opponent: number;
  current_streak: { who: 'you' | 'opponent' | 'none'; count: number };
  longest_streak: { who: 'you' | 'opponent'; count: number };
  hands_played: number;
  last_match_date: string | null; // ISO
}

interface Moment {
  kind: 'bad_beat' | 'cooler' | 'biggest_pot' | 'streak_start' | 'milestone';
  hand_id?: string;
  match_index?: number;
  pot_bb: number; // pot expressed in big blinds
  my_hole?: string[];
  opponent_hole?: string[];
  board?: string[];
  copy: string; // display-ready string, e.g. "TJ's AA lost to runner-runner flush"
  occurred_at: string;
}

interface HeadToHead {
  vpip_you: number; // percentage 0-100
  vpip_opponent: number;
  aggression_you: number; // (bets+raises) / calls
  aggression_opponent: number;
  showdown_win_pct_you: number;
  showdown_win_pct_opponent: number;
  avg_pot_bb: number;
  showdowns: number;
}

interface PinnedHand {
  hand_id: string;
  match_index: number;
  hand_index_in_round: number;
  my_hole: string[];
  opponent_hole: string[] | null;
  board: string[];
  pot: number;
  pot_bb: number;
  winner_user_id: string | null;
  tag: 'cooler' | 'bad_beat' | 'bluff' | 'flush' | 'straight' | 'set' | 'pair' | 'highcard' | 'favorite';
  tag_copy: string; // e.g. "Cooler" or "240 BB cooler"
  favorited_at: string;
}

export async function getMatchUp(db: Database, userId: string): Promise<MatchUpView> {
  const isUserTJ = userId === USER_TJ_ID;
  const opponentId = isUserTJ ? USER_SL_ID : USER_TJ_ID;

  const [you, opponent] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.userId, userId) }),
    db.query.users.findFirst({ where: eq(users.userId, opponentId) }),
  ]);
  if (!you || !opponent) throw new Error('Users not found');

  const initials = (name: string) => name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

  const scoreboard = await computeScoreboard(db, userId, opponentId);
  const headToHead = await computeHeadToHead(db, userId, opponentId);
  const moments = await computeMoments(db, userId, opponentId);
  const pinnedHands = await computePinnedHands(db, userId);

  return {
    you: { user_id: you.userId, display_name: you.displayName, initials: initials(you.displayName) },
    opponent: { user_id: opponent.userId, display_name: opponent.displayName, initials: initials(opponent.displayName) },
    scoreboard,
    moments,
    head_to_head: headToHead,
    pinned_hands: pinnedHands,
  };
}
```

**Implementation notes for each computation:**

**`computeScoreboard`**:
- `matches_won_you`: count matches where `status='ended' AND winner_user_id = userId`
- `matches_won_opponent`: same for opponent
- `hands_played`: total hands across all matches (status='complete' or 'awaiting_runout')
- `last_match_date`: max `ended_at` from matches
- `current_streak`: walk matches in reverse chronological order, count consecutive wins for the current leader
- `longest_streak`: iterate all matches in order, track max run per player

**`computeHeadToHead`**:
All percentages computed across all `actions` rows joined with `hands` and `rounds`.

- **VPIP**: % of hands where user voluntarily put money in preflop. Voluntary = call (not the BB's check-back) or raise. Denominator = hands the user saw preflop.
  ```sql
  -- For each user: count hands where any preflop action by user was 'call' or 'raise' or 'all_in' (not check)
  -- Divide by total hands the user participated in
  ```
- **Aggression Factor**: (count bets + raises + all-ins) / (count calls) across all streets for this user.
- **Showdown win %**: count hands where `terminal_reason='showdown' AND winner_user_id=userId` / count showdowns user was in.
- **Avg pot BB**: average of `hands.pot / matches.blind_big` across completed hands (BB from the match the hand is in).
- **Showdowns**: count of hands where `terminal_reason='showdown'` across all matches.

**`computeMoments`** (up to 5, sorted by `occurred_at` desc):
For MVP, detect these three kinds:

1. **biggest_pot**: the single largest pot (in BB) across all completed hands in the rivalry. Copy: `"Biggest pot — {winner_name}'s {my_hand_rank} · {pot_bb} BB"`

2. **bad_beat**: at showdown, the loser had a made hand of 3-of-a-kind or better AND the winner's hand was a type that "outdrew" on a late street. For MVP, simplify: **losing with trips/set/straight/flush/fullhouse/quads at showdown = bad beat**. Take up to 1 most recent. Copy: `"{loser}'s {loser_hand_rank} lost to {winner_hand_rank}"`

3. **cooler**: at showdown, both players had two-pair-or-better, winner ≥ loser's category + 1 (e.g. set vs two pair doesn't count; set vs straight, full house vs flush, etc.). Take up to 1 most recent. Copy: `"{winner_hand_rank} over {loser_hand_rank}"`

Fall back to `streak_start` (most recent W/L flip) and `milestone` (e.g. 100 hands played, 1000 hands played) if no moments detected.

Use `src/engine/evaluator.ts` for hand ranking.

**`computePinnedHands`**:
- Source: all favorites for this user, joined with hand+round+match.
- For each, compute:
  - `pot_bb = hand.pot / match.blind_big`
  - `tag`: based on hand rank and outcome. Same logic as bad_beat/cooler detection but simpler:
    - If hand rank is flush: `tag='flush', tag_copy='{pot_bb} BB flush'`
    - If set: `'set'`
    - If bad beat condition: `'bad_beat'`
    - Else: `'favorite'`, copy = `'{pot_bb} BB {hand_rank}'`
- Sort by `favorited_at DESC` (most recent first).
- Return up to 20 (client shows first 4 in grid, rest on tap-through).

### 2.2 Server: API route

**File: new `apps/server/src/api/routes/matchup.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { getDb } from '../context.js';
import { getMatchUp } from '../../game/matchup.js';

export async function matchupRoutes(app: FastifyInstance) {
  app.get('/matchup', async (req) => {
    const db = getDb();
    return getMatchUp(db, req.userId);
  });
}
```

Register in `app.ts` inside the authenticated block.

### 2.3 iOS: MatchUpView

**File: new `apps/ios/Tilted/Tilted/Views/MatchUp/MatchUpView.swift`**

Matches the mockup's Option 01 exactly. Sections in order:

1. **Scoreboard Hero** (top):
   - Eyebrow: "CAREER MATCH-UP" in gold
   - Two avatars side-by-side with match counts underneath (Georgia 42pt)
   - Separator: `–`
   - Subtitle: "W3 streak · 1,432 hands · Match 11 yesterday"

2. **Moments section**:
   - Eyebrow: "💎 MOMENTS"
   - One card per moment, max 3 displayed. Each card:
     - Tag pill (color per kind: gold for cooler/biggest_pot, claret for bad_beat, cream for milestone)
     - Match index on right
     - Copy text in 12pt cream-100

3. **Head-to-Head bars section**:
   - Eyebrow: "⚔ HEAD TO HEAD"
   - 3 bars: VPIP, Aggression, Showdown win %. Layout: your-value | label | opponent-value, with a two-color bar below. Gold for you, cream for opponent.

4. **Pinned Hands section**:
   - Eyebrow: "📌 PINNED HANDS · {count}"
   - 2-column grid of up to 4 hands. Each card:
     - Top-right pin emoji
     - Match + hand index (e.g. "M3 H7")
     - Two small card faces
     - Tag in gold/claret (e.g. "240 BB cooler")
   - Tap any pin → open the hand detail view (existing `HandDetailView`)

**File: new `apps/ios/Tilted/Tilted/Networking/Models/MatchUpModels.swift`**

```swift
struct MatchUpResponse: Codable {
    let you: UserSummary
    let opponent: UserSummary
    let scoreboard: Scoreboard
    let moments: [Moment]
    let headToHead: HeadToHead
    let pinnedHands: [PinnedHand]

    enum CodingKeys: String, CodingKey {
        case you, opponent, scoreboard, moments
        case headToHead = "head_to_head"
        case pinnedHands = "pinned_hands"
    }
}

struct UserSummary: Codable {
    let userId: String
    let displayName: String
    let initials: String
    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case displayName = "display_name"
        case initials
    }
}

struct Scoreboard: Codable {
    let matchesWonYou: Int
    let matchesWonOpponent: Int
    let currentStreak: Streak
    let longestStreak: Streak
    let handsPlayed: Int
    let lastMatchDate: String?
    enum CodingKeys: String, CodingKey {
        case matchesWonYou = "matches_won_you"
        case matchesWonOpponent = "matches_won_opponent"
        case currentStreak = "current_streak"
        case longestStreak = "longest_streak"
        case handsPlayed = "hands_played"
        case lastMatchDate = "last_match_date"
    }
}

struct Streak: Codable {
    let who: String  // "you" | "opponent" | "none"
    let count: Int
}

struct Moment: Codable, Identifiable {
    let kind: String
    let handId: String?
    let matchIndex: Int?
    let potBb: Int
    let myHole: [String]?
    let opponentHole: [String]?
    let board: [String]?
    let copy: String
    let occurredAt: String

    var id: String { handId ?? "\(kind)-\(occurredAt)" }
    enum CodingKeys: String, CodingKey {
        case kind
        case handId = "hand_id"
        case matchIndex = "match_index"
        case potBb = "pot_bb"
        case myHole = "my_hole"
        case opponentHole = "opponent_hole"
        case board, copy
        case occurredAt = "occurred_at"
    }
}

struct HeadToHead: Codable {
    let vpipYou: Double
    let vpipOpponent: Double
    let aggressionYou: Double
    let aggressionOpponent: Double
    let showdownWinPctYou: Double
    let showdownWinPctOpponent: Double
    let avgPotBb: Double
    let showdowns: Int
    enum CodingKeys: String, CodingKey {
        case vpipYou = "vpip_you"
        case vpipOpponent = "vpip_opponent"
        case aggressionYou = "aggression_you"
        case aggressionOpponent = "aggression_opponent"
        case showdownWinPctYou = "showdown_win_pct_you"
        case showdownWinPctOpponent = "showdown_win_pct_opponent"
        case avgPotBb = "avg_pot_bb"
        case showdowns
    }
}

struct PinnedHand: Codable, Identifiable {
    let handId: String
    let matchIndex: Int
    let handIndexInRound: Int
    let myHole: [String]
    let opponentHole: [String]?
    let board: [String]
    let pot: Int
    let potBb: Int
    let winnerUserId: String?
    let tag: String
    let tagCopy: String
    let favoritedAt: String

    var id: String { handId }
    enum CodingKeys: String, CodingKey {
        case handId = "hand_id"
        case matchIndex = "match_index"
        case handIndexInRound = "hand_index_in_round"
        case myHole = "my_hole"
        case opponentHole = "opponent_hole"
        case board, pot
        case potBb = "pot_bb"
        case winnerUserId = "winner_user_id"
        case tag
        case tagCopy = "tag_copy"
        case favoritedAt = "favorited_at"
    }
}
```

**File: `apps/ios/Tilted/Tilted/Networking/APIClient.swift`**

Add:

```swift
func getMatchUp() async throws -> MatchUpResponse {
    return try await get("/v1/matchup")
}
```

**Styling specifics from mockup (matchup-options-v2.html Option 01)**:

- Felt gradient background (existing `.feltBackground()`)
- Padding 12-14 horizontal on sections
- Eyebrow text: 10pt, letter-spacing 1.5, uppercase
- Gold = `Color.gold500`, cream shades per design tokens
- Card backgrounds: `LinearGradient` from `rgba(255,255,255,0.04)` to `rgba(0,0,0,0.2)` with `Color.gold500.opacity(0.2)` border
- Moments/Pinned cards have rounded-corner 10pt
- Scoreboard avatars: existing `AvatarView` component, `.lg` size

**MatchUpView skeleton**:

```swift
struct MatchUpView: View {
    @Environment(AppStore.self) private var store
    @State private var data: MatchUpResponse?
    @State private var isLoading = true
    @State private var selectedHandId: String?

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            if isLoading {
                ProgressView().tint(.gold500)
            } else if let data = data {
                ScrollView {
                    VStack(spacing: 0) {
                        scoreboardHero(data)
                        momentsSection(data.moments)
                        headToHeadSection(data.headToHead)
                        pinnedHandsSection(data.pinnedHands)
                    }
                    .padding(.vertical, 16)
                }
                .refreshable { await load() }
            }
        }
        .task { await load() }
        .sheet(item: $selectedHandId.asIdentifiable) { item in
            HandDetailView(handId: item.value)
                .environment(store)
        }
    }

    private func load() async {
        isLoading = true
        do {
            data = try await APIClient.shared.getMatchUp()
        } catch {
            print("MatchUp load error: \(error)")
        }
        isLoading = false
    }

    // ... section builders
}
```

**On pinned hand tap**: open `HandDetailView(handId: pinned.handId)` via sheet.

---

## 3. Hand Endings — Extend Center-Stage to All Resolutions

**Existing state**:
- `ShowdownResultView` exists (`apps/ios/Tilted/Tilted/Views/Turn/ShowdownResultView.swift`) and handles showdown + split pot for hands that complete during a user's action.
- `AllInRevealCard` (in `RevealView.swift`) handles all-in runouts at round end.
- Preflop folds and postflop folds currently just drop into the "Resolved" chip pill section with no celebration screen.

**Required change**:
Fire `ShowdownResultView` (or a new variant) for **every** hand that resolves during the user's current action — not just showdowns.

### 3.1 Extend ShowdownResultView to handle folds

**File: `apps/ios/Tilted/Tilted/Views/Turn/ShowdownResultView.swift`**

Current `ShowdownResultView` already has `isSplit`, `isWin` logic. Add a third case: `isFold`. Pass this via a new init param or derive from the hand:

```swift
private var isFold: Bool {
    hand.terminalReason == "fold"
}

// Determine if we folded or opponent folded
private var iFolded: Bool {
    // This is trickier — the HandView is user-scoped.
    // We can check: if winnerUserId is me, opponent folded. If winnerUserId is opponent, I folded.
    guard isFold, let winner = hand.winnerUserId else { return false }
    return winner == match.opponent.userId
}
```

Render different content depending on `isFold`:
- **Opponent folded** (you won):
  - Title: "HAND {N} · {STREET}" in gold
  - Your cards with glow
  - Middle: opponent's muck placeholder (dashed border cards with "?")
  - Caption: "{Opponent name} folded to your raise" (preflop) or "...to your bet" (postflop)
  - Board (if flop+ was dealt): small cards
  - Amount: `+pot` in gold
  - Bookmark + Next CTA
- **You folded** (you lost):
  - Title: "HAND {N} · {STREET}" in cream
  - Your cards dimmed
  - Caption: "You folded to {opponent}'s bet"
  - Amount: `-myReserved` in claret
  - Bookmark + Next CTA

### 3.2 Trigger for folds

**File: `apps/ios/Tilted/Tilted/Views/Turn/TurnView.swift`**

Currently in `submitAction()`:
```swift
if updatedHand.status == "complete" && updatedHand.terminalReason == "showdown" {
    showdownResult = updatedHand
    return
}
```

Change to:
```swift
if updatedHand.status == "complete" {
    // Fires for both showdown AND fold
    showdownResult = updatedHand
    return
}
```

This means when a user folds their own hand, after the optimistic update the `showdownResult` state is set with the now-complete hand.

**Caveat**: when the user folds, their hole cards get blanked server-side (spec §11). The optimistic update does NOT blank them immediately. For the fold screen, we want to show the user's own cards briefly (that's the info they just gave up). So the optimistic HandView on fold keeps my_hole populated — render from that.

### 3.3 Auto-acted hands (batch)

When 0 available triggers auto-fold on multiple hands, we do NOT want the result screen to fire 9 times in a row. Instead:
- Skip the per-hand `ShowdownResultView` during the auto-act phase.
- Let the existing Turn Summary view handle the batch presentation (already shows auto-acted hands).

In `TurnView.submitAction`, only fire `showdownResult` if this was a **deliberate** user action (not called from `autoActIfNeeded`). Simplest: add a param:

```swift
private func submitAction(hand: HandView, type: String, amount: Int? = nil, suppressResultScreen: Bool = false) async {
    // ... existing logic
    if !suppressResultScreen, updatedHand.status == "complete" {
        showdownResult = updatedHand
        return
    }
}
```

And in `autoActIfNeeded`, call with `suppressResultScreen: true`.

### 3.4 Result screen content requirements (full detail)

Ensure `ShowdownResultView` displays:
- Hand number and street where resolved (e.g. "HAND 3 · FLOP")
- Your cards with gold glow (if won) or dimmed (if lost)
- Opponent cards with flip animation (if showdown) or muck placeholder (if they folded)
- Both hand rank names (if showdown — use `detail.myHandRank` / `detail.opponentHandRank`)
- Full board (if any cards dealt) as small cards
- Result banner: "You win" / "You lose" / "Split pot"
- Amount: `+pot` or `-myReserved` in Georgia 48pt
- Pot in BB: small caption e.g. "85 BB pot"
- Bookmark toggle
- **Dual-footer CTA** (see Feature 4 below)

If `detail.myHandRank` / `opponentHandRank` are nil (fold cases, no showdown), skip those lines.

---

## 4. Transitions — Dual Footer in Detail Sheet

### 4.1 Update `HandActionDetailSheet`

**File: `apps/ios/Tilted/Tilted/Views/Turn/TurnView.swift`** (contains `HandActionDetailSheet`)

Add dual-footer navigation buttons that replace the existing bottom action buttons **after** the user acts.

**Before action** (current state): action buttons (Fold/Call/Raise/All-In) shown.

**After action resolves** (new state): content scrolls down slightly, bottom shows:
```
[↑ All Hands]  [Next Hand →]
```

Since the current flow dismisses the sheet immediately on action, we need to change this: keep the sheet open, show the result inline, then present the dual footer.

**However**, Center-Stage `ShowdownResultView` is the source of truth for post-action visuals (per Feature 3). So: the dual footer should live on **`ShowdownResultView`**, NOT on the `HandActionDetailSheet` itself.

**Revised plan**:
- `HandActionDetailSheet` stays as-is before action (shows action buttons at bottom).
- On action, the sheet dismisses normally.
- `ShowdownResultView` (which now fires for all completions) has the dual footer.

### 4.2 ShowdownResultView dual footer

**File: `apps/ios/Tilted/Tilted/Views/Turn/ShowdownResultView.swift`**

Replace the current single "Next Hand →" primary button with:

```swift
VStack(spacing: 8) {
    // Subtitle: how many pending left
    Text("\(remainingPendingCount) more pending")
        .font(.system(size: 10))
        .foregroundColor(.cream400)

    HStack(spacing: 8) {
        // Back to all hands (secondary)
        Button {
            onBackToList()
        } label: {
            Text("↑ All Hands")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.cream200)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Color.black.opacity(0.3))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.gold500.opacity(0.3), lineWidth: 1)
                )
                .cornerRadius(10)
        }

        // Next hand (primary)
        Button {
            onNextHand()
        } label: {
            Text("Next Hand →")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.felt800)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom))
                .cornerRadius(10)
                .shadow(color: .black.opacity(0.25), radius: 0, y: 3)
        }
        .disabled(!hasNextPending)
        .opacity(hasNextPending ? 1 : 0.4)
    }
}
.padding(.horizontal, 24)
.padding(.bottom, 32)
```

Requires two new parameters on `ShowdownResultView`:
- `remainingPendingCount: Int`
- `hasNextPending: Bool`
- `onBackToList: () -> Void`
- `onNextHand: () -> Void`

(Remove the old `onContinue` param or repurpose it.)

**In `TurnView`** where `ShowdownResultView` is instantiated:

```swift
ShowdownResultView(
    hand: result,
    match: store.matchState ?? match,
    remainingPendingCount: pendingHands.filter { $0.handId != result.handId }.count,
    hasNextPending: nextPendingHand != nil,
    onFavorite: { fav in
        Task { await store.toggleFavorite(handId: result.handId, favorite: fav) }
    },
    onBackToList: {
        showdownResult = nil
        checkTurnComplete()
    },
    onNextHand: {
        showdownResult = nil
        if let next = nextPendingHand {
            selectedHand = next
        } else {
            checkTurnComplete()
        }
    }
)
```

Add a computed property:
```swift
private var nextPendingHand: HandView? {
    // Pick a pending hand other than the one just resolved
    pendingHands.first(where: { $0.handId != showdownResult?.handId })
}
```

**Behavior**:
- `onBackToList`: dismisses the result screen, returns to the grouped list view (existing behavior).
- `onNextHand`: dismisses the result AND immediately opens `HandActionDetailSheet` for the next pending hand.
- If no more pending hands, `Next Hand` button is disabled (greyed).

### 4.3 Visual details

Match mockup `transition-options-v2.html` Option 01:
- Secondary "All Hands" button: transparent background, gold-500 at 30% opacity border, cream-200 text, arrow-up glyph.
- Primary "Next Hand" button: gold gradient, felt-800 text (dark on gold), subtle shadow.
- Both flex: 1 (equal width). Actually primary is `flex: 1.2` in mockup — 20% wider than secondary. Reflect that with:
  ```swift
  // Back button
  .frame(maxWidth: .infinity).frame(maxWidth: 130)  // narrower cap
  // Next button wraps remaining
  ```
  Or use GeometryReader / fractional sizing.
- "N more pending" caption above in cream-400, 10pt.

---

## 5. Testing Checklist

### Server
- [ ] `pnpm test` — all 84+ existing tests still pass
- [ ] New tests for `computeScoreboard`, `computeHeadToHead`, `computeMoments`, `computePinnedHands` (use the existing ephemeral Postgres test setup)
- [ ] New test for `dispatch` function — assert APNS client called with correct payload per kind
- [ ] New test for `runReminders` — seed a past-due row, run, assert dispatch fired
- [ ] `GET /v1/matchup` integration test: auth as TJ, get response, assert shape

### iOS
- [ ] `MatchUpView` renders with mock data (SwiftUI Preview with fake `MatchUpResponse`)
- [ ] Tab bar switches between 4 tabs; Match-up loads fresh data
- [ ] `ShowdownResultView` variants: win showdown, loss showdown, split, opponent-folded, I-folded
- [ ] Dual-footer: `Next Hand` disabled when no more pending
- [ ] Dual-footer: `Next Hand` opens next pending hand's detail sheet directly
- [ ] Dual-footer: `All Hands` dismisses result screen back to list
- [ ] Auto-acted folds do NOT each fire the result screen (batch path suppresses)

### End-to-end playtesting
- [ ] Start match → coin flip → notification goes to opponent (match_started)
- [ ] Act on all hands → notification goes to opponent (turn_handoff)
- [ ] Round ends with all-in → round_complete push
- [ ] Match ends → match_ended push for both
- [ ] Leave a turn hanging for 6h+ → reminder fires
- [ ] Tap notification → deep-links correctly
- [ ] Bookmark a hand → appears on Match-up page under Pinned Hands
- [ ] Play enough hands for a bad beat to trigger → appears under Moments

---

## 6. Implementation Order

1. **Tab bar + empty `MatchUpView`** (stub, just proves routing works)
2. **Server `/v1/matchup` endpoint + scoreboard + H2H + pinned** (no moments yet)
3. **Hook MatchUpView to real data**
4. **Moments detection** (bad beat, cooler, biggest pot) + display
5. **Hand ending result screen — extend to folds**
6. **Dual-footer on result screen**
7. **Next-hand handoff wiring**
8. **APNS setup + four triggers + dispatchers**
9. **6h reminder table + cron**
10. **Deep-link from notification tap**

Each step is independently deployable. Commits should be scoped to one step at a time.

---

## 7. Files Created vs Modified

**New:**
- `apps/ios/Tilted/Tilted/Views/MatchUp/MatchUpView.swift`
- `apps/ios/Tilted/Tilted/Networking/Models/MatchUpModels.swift`
- `apps/server/src/game/matchup.ts`
- `apps/server/src/api/routes/matchup.ts`
- `apps/server/src/notif/dispatchers.ts`
- `apps/server/src/notif/reminder-cron.ts`
- `apps/server/src/cli/run-reminders.ts` (optional, if going with Fly cron path)

**Modified:**
- `apps/ios/Tilted/Tilted/App/TiltedApp.swift` (add MainTabView, AppDelegate)
- `apps/ios/Tilted/Tilted/Views/Home/HomeView.swift` (remove History/Settings buttons, remove their covers)
- `apps/ios/Tilted/Tilted/Views/Turn/TurnView.swift` (fire result screen for folds, wire Next Hand handoff)
- `apps/ios/Tilted/Tilted/Views/Turn/ShowdownResultView.swift` (add fold variants, dual footer, new params)
- `apps/ios/Tilted/Tilted/Networking/APIClient.swift` (add `getMatchUp()`)
- `apps/ios/Tilted/Tilted/Push/PushRegistrar.swift` (deep-link on tap)
- `apps/server/src/db/schema.ts` (add `pendingReminders` table)
- `apps/server/src/app.ts` (register matchup route, start reminder interval)
- `apps/server/src/game/match.ts` (dispatch match_started after commit)
- `apps/server/src/game/round.ts` (dispatch match_ended when match busts)
- `apps/server/src/game/turn.ts` (dispatch round_complete when round→revealing; replace existing dispatchPush with dispatch)
- `apps/server/src/notif/apns.ts` (keep sendApnsPush, remove dispatchPush)
- `fly.toml` (if going with Fly cron — otherwise just needs secret env vars)

Estimate: ~3 days of focused work for an experienced engineer.

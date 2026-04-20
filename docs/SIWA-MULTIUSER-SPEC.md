# Sign in with Apple + Multi-User Expansion — Implementation Spec

**Status:** Approved, ready for implementation.
**Scope:** Lift Tilted from 2 hardcoded users to N real users authenticated via Sign in with Apple (SIWA). Replace the global "one active match" invariant with per-pair matches.

---

## 0. Goals and non-goals

**Goals:**
- Real auth (Apple identity) so the app can be opened up to 10–20 friends.
- Any authenticated user can challenge any other authenticated user.
- Everything that used to assume "2 users, 1 match" scales to "N users, M pairs of active matches."
- Apple Store guidelines are met: SIWA button, in-app account deletion, revocation webhook handled.

**Non-goals (deferred):**
- Invite-only / friend list gating. For now anyone who signs in is challengeable by anyone else who signs in. The user pool is small and trusted.
- Password-based or email-only auth. SIWA only.
- Android / web clients.
- Server-initiated push for "someone new joined" etc.
- Tournaments, groups, leaderboards. One-to-one rivalries only.

---

## 1. Architecture overview

```
iOS                         Server                       Apple

[SignInView]                                             [Apple ID]
  | SIWA button                                              ^
  v                                                          | JWKS
[AuthorizationController]                                    |
  | identity_token (JWT) +                                   |
  | user { name, email } [first-time only]                   |
  v
POST /v1/auth/apple ---------> [authApple]
                                 - fetch JWKS
                                 - verify JWT
                                 - upsert users by apple_sub
                                 - mint bearer token
                                 <-- { token, user }

[Home: match list]           [listActiveMatches]
  | opponent_user_id
  v
POST /v1/match -------------->  [createMatch(opponent)]
                                 - remove "one match" uniqueness
                                 - scope state to (me, opponent)

[MatchUpView(opponent)]      [getMatchUp(user, opponent)]
[HistoryView(opponent)]      [getHistory(user, opponent)]
```

**Data model changes:**
- `users` gains `apple_sub`, `email`, `full_name`
- `matches_one_active_idx` unique constraint dropped; replaced with an application-level check `(user_a_id, user_b_id, status='active')` must be unique
- Hardcoded `USER_TJ_ID` / `USER_SL_ID` references removed from match, matchup, and history code paths; replaced with the requesting user + the match's opponent

**Auth model:**
- SIWA identity token verified per-request at sign-in only.
- Our bearer token model stays (the `debug_tokens` table — renamed `auth_tokens` in a later pass but not this sprint).
- Bearers have no expiry for MVP (Apple itself revokes if the user deletes the Apple ID binding).

---

## 2. Sprint A — Sign in with Apple backbone

### A1: Enable Sign in with Apple capability

**Apple Developer portal (manual, TJ does this one-time):**
1. Certificates, Identifiers & Profiles → Identifiers → `com.thomasjjohnston.tilted`.
2. Under Capabilities, check **Sign in with Apple**. Leave "Primary App ID."
3. Save.

The provisioning profile gets re-issued with the SIWA entitlement automatically on next Xcode archive with automatic signing.

**Code changes:**

`apps/ios/Tilted/project.yml` — extend the entitlements `properties` block:

```yaml
entitlements:
  path: Tilted/Tilted.entitlements
  properties:
    aps-environment: production
    com.apple.developer.applesignin:
      - Default
```

Regen with `xcodegen generate`; the resulting `Tilted.entitlements` will contain the SIWA array.

Bump `CURRENT_PROJECT_VERSION` + `MARKETING_VERSION` when archiving for TestFlight.

**Acceptance:**
- `codesign -d --entitlements -` on the archived .app shows both `aps-environment` and `com.apple.developer.applesignin` keys.

---

### A2: Extend `users` table for Apple identity

**Migration:** `apps/server/drizzle/0002_siwa_users.sql`.

```sql
ALTER TABLE users
  ADD COLUMN apple_sub TEXT UNIQUE,
  ADD COLUMN email TEXT,
  ADD COLUMN full_name TEXT;
```

**Schema** (`apps/server/src/db/schema.ts`):

```ts
export const users = pgTable('users', {
  userId: uuid('user_id').primaryKey().defaultRandom(),
  appleSub: text('apple_sub').unique(),                 // NEW: null for legacy
  email: text('email'),                                 // NEW
  fullName: text('full_name'),                          // NEW
  displayName: text('display_name').notNull(),          // unchanged
  apnsToken: text('apns_token'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**`displayName` becomes a derived/admin field.** For SIWA sign-ins, it defaults to `full_name` on first login, falls back to the email local-part, falls back to `"User"`. Never null.

**Legacy users (TJ, SL):** their rows stay. `apple_sub` is null. On their next SIWA login, we match on email (if Apple provides it) or prompt for a one-time "claim this account" flow. For MVP simplicity: we just treat each new SIWA login as a new user and let the legacy rows rot. Migration writeup covers this.

**Acceptance:**
- `pnpm test` still passes (84 + new ones).
- Migration runs cleanly against the prod Neon DB.

---

### A3: Server `POST /v1/auth/apple` endpoint

**File:** new `apps/server/src/api/routes/auth-apple.ts`.

**Request body (zod):**
```ts
const authBody = z.object({
  identity_token: z.string(),
  // Apple only sends these on the very first sign-in for a given user.
  full_name: z.string().optional(),
  email: z.string().email().optional(),
});
```

**Flow:**

1. Fetch Apple's JWKS from `https://appleid.apple.com/auth/keys`. Cache the keys in memory; refresh if >1h old or if key lookup misses.
2. Decode the JWT header → find `kid`. Look up matching key in JWKS.
3. Verify the JWT signature with the matching public key (RS256).
4. Validate claims:
   - `iss === "https://appleid.apple.com"`
   - `aud === "com.thomasjjohnston.tilted"`
   - `exp > now`
   - `iat < now + 60s` (small clock skew allowance)
5. Extract `sub` (Apple's stable user ID).
6. Upsert into `users`:
   - If row exists with this `apple_sub`: just return it (update `email` if newly provided, `full_name` if newly provided).
   - If no row: insert, populate `display_name` from `full_name` || email local-part || `"User"`.
7. Mint a bearer token (random 32 bytes hex), hash it, insert into `debug_tokens` with the user's `user_id`.
8. Return `{ token, user_id, display_name }` (same shape as debug auth).

**File:** new `apps/server/src/auth/apple-jwt.ts` — JWKS fetcher + verifier. Use Node's `crypto.verify` for RS256, same pattern as APNS JWT. No third-party library.

**Test:**
Mock the JWKS endpoint with a locally-generated RSA keypair; sign a test JWT; assert verification succeeds. Assert bad sig, wrong aud, expired all fail with clear errors.

**Register** in `app.ts`:
```ts
await app.register(authAppleRoutes, { prefix: '/v1' });   // OUTSIDE the bearer-auth block
```

**Rate limit:** see story E1.

**Acceptance:**
- Posting a valid Apple identity token creates or matches a `users` row and returns a bearer.
- Posting a forged / expired token returns 401.
- JWKS is cached between requests.

---

### A4: iOS Sign in with Apple flow

**File:** new `apps/ios/Tilted/Tilted/Views/SignIn/SignInView.swift`.

```swift
import SwiftUI
import AuthenticationServices

struct SignInView: View {
    @Environment(AppStore.self) private var store
    @State private var error: String?

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()
            VStack(spacing: Spacing.xl) {
                Spacer()
                Text("TILTED")
                    .font(.eyebrow).tracking(3)
                    .foregroundColor(.gold500)
                Text("Heads-up poker\nwith friends.")
                    .font(.displayLarge).fontDesign(.serif)
                    .foregroundColor(.cream100)
                    .multilineTextAlignment(.center)
                Spacer()
                SignInWithAppleButton(
                    onRequest: { req in
                        req.requestedScopes = [.fullName, .email]
                    },
                    onCompletion: handleResult
                )
                .signInWithAppleButtonStyle(.white)
                .frame(height: 52)
                .padding(.horizontal, 40)
                if let error {
                    Text(error).font(.caption).foregroundColor(.claret)
                }
                Spacer().frame(height: 32)
            }
        }
    }

    private func handleResult(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure(let err):
            error = err.localizedDescription
        case .success(let auth):
            guard let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8) else {
                error = "Missing identity token from Apple"
                return
            }
            let fullName: String? = [credential.fullName?.givenName, credential.fullName?.familyName]
                .compactMap { $0 }.joined(separator: " ").nilIfEmpty
            Task {
                do {
                    try await store.signInWithApple(identityToken: token, fullName: fullName, email: credential.email)
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}
```

**`AppStore.signInWithApple`:**

```swift
func signInWithApple(identityToken: String, fullName: String?, email: String?) async throws {
    let resp = try await APIClient.shared.signInApple(identityToken: identityToken, fullName: fullName, email: email)
    await APIClient.shared.setToken(resp.token)
    KeychainHelper.save(key: "auth_token", value: resp.token)
    KeychainHelper.save(key: "user_id", value: resp.userId)
    KeychainHelper.save(key: "user_name", value: resp.displayName)
    self.currentUserId = resp.userId
    self.currentUserName = resp.displayName
    self.isAuthenticated = true
    PushRegistrar.shared.uploadTokenIfAuthenticated()
    await refresh()
}
```

**APIClient.signInApple:**

```swift
func signInApple(identityToken: String, fullName: String?, email: String?) async throws -> AuthResponse {
    var body: [String: Any] = ["identity_token": identityToken]
    if let fullName { body["full_name"] = fullName }
    if let email { body["email"] = email }
    return try await post("/v1/auth/apple", body: body, authenticated: false)
}
```

**Acceptance:**
- Fresh install → lands on `SignInView` → tap button → Apple modal → server returns token → lands on Home.
- Subsequent launches skip the button (Keychain bearer loaded).
- Cancelling Apple modal shows no error, sign-in button stays.

---

### A5: Gate `DebugPickerView` behind a compile flag

`DebugPickerView` stays useful for local dev (TJ + Stephen without needing Apple modals). Hide it for Release builds.

**`RootView` in TiltedApp.swift:**

```swift
var body: some View {
    Group {
        if store.isAuthenticated {
            MainTabView()
        } else {
            #if DEBUG
            DebugPickerView()
            #else
            SignInView()
            #endif
        }
    }
    .preferredColorScheme(.dark)
    .onAppear { store.checkAuth() }
}
```

DEBUG builds fall through to `DebugPickerView` (existing PIN login). Release/Archive builds get `SignInView`.

**Drop** the `HardcodedUsers` PIN array for Release-only compilation later — keep for DEBUG.

**Acceptance:**
- TestFlight / Release → `SignInView`.
- Xcode Run → `DebugPickerView` (so TJ can still log in as TJ without an Apple flow).

---

### A6: In-app account deletion

Required by App Store Review Guideline 5.1.1(v) for any app offering SIWA.

**Server:** new `DELETE /v1/me` route in `me.ts`.

```ts
app.delete('/me', async (req) => {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Delete everything owned by this user. FK cascades would be cleaner but
    // we don't have them set up — enumerate explicitly.
    const userMatches = await tx.query.matches.findMany({
      where: or(eq(matches.userAId, req.userId), eq(matches.userBId, req.userId)),
    });
    for (const m of userMatches) {
      const ms = await tx.query.rounds.findMany({ where: eq(rounds.matchId, m.matchId) });
      for (const r of ms) {
        const hs = await tx.query.hands.findMany({ where: eq(hands.roundId, r.roundId) });
        for (const h of hs) {
          await tx.delete(actions).where(eq(actions.handId, h.handId));
          await tx.delete(favorites).where(eq(favorites.handId, h.handId));
        }
        await tx.delete(turnHandoffs).where(eq(turnHandoffs.roundId, r.roundId));
        await tx.delete(pendingReminders).where(eq(pendingReminders.roundId, r.roundId));
        await tx.delete(hands).where(eq(hands.roundId, r.roundId));
      }
      await tx.delete(pendingReminders).where(eq(pendingReminders.matchId, m.matchId));
      await tx.delete(rounds).where(eq(rounds.matchId, m.matchId));
    }
    await tx.delete(matches).where(or(eq(matches.userAId, req.userId), eq(matches.userBId, req.userId)));
    await tx.delete(debugTokens).where(eq(debugTokens.userId, req.userId));
    await tx.delete(users).where(eq(users.userId, req.userId));
  });
  // Best-effort: revoke the Apple refresh/auth token on Apple's side.
  // Apple requires a Service-ID key for this; skip for MVP if not configured.
  return { ok: true };
});
```

**iOS:** add to `SettingsView.swift`:

```swift
Section {
    Button("Delete Account", role: .destructive) {
        showDeleteConfirm = true
    }
    .foregroundColor(.claret)
} header: {
    Text("Danger Zone")
}
.alert("Delete your account?", isPresented: $showDeleteConfirm) {
    Button("Cancel", role: .cancel) {}
    Button("Delete", role: .destructive) {
        Task { await deleteAccount() }
    }
} message: {
    Text("This removes your match history, pinned hands, and Apple sign-in binding. You can sign back in later, but nothing will be restored.")
}
```

`AppStore.deleteAccount()` calls `DELETE /v1/me`, then calls `logout()`.

**Acceptance:**
- Endpoint deletes all user-owned rows in a single transaction.
- iOS → Settings → Delete Account → confirmation → returns to sign-in screen.

---

## 3. Sprint B — Multi-match plumbing

### B1: Drop single-match uniqueness

**Migration:** `0003_multi_match.sql`.

```sql
DROP INDEX IF EXISTS matches_one_active_idx;
```

Schema update: remove the `uniqueIndex('matches_one_active_idx')` from `matches` table definition.

**Schema-level replacement:** application-level check. In `createMatch`, before inserting, query for an existing `active` match with the same `(user_a_id, user_b_id)` pair (any ordering) and reject if one exists.

**Acceptance:**
- Two different pairs can have active matches simultaneously.
- Same pair can't have two active matches.

---

### B2: Per-pair match state + list endpoint

**Remove the `USER_TJ_ID`/`USER_SL_ID` assumption** in `match.ts`, `matchup.ts`.

**New endpoint:** `GET /v1/matches` — returns `MatchStateView[]` for the requesting user (all currently-active matches).

```ts
app.get('/matches', async (req) => {
  const db = getDb();
  return listActiveMatches(db, req.userId);
});
```

`listActiveMatches` in `match.ts`:

```ts
export async function listActiveMatches(db: Database, userId: string): Promise<MatchStateView[]> {
  const matchRows = await db.query.matches.findMany({
    where: and(
      eq(matches.status, 'active'),
      or(eq(matches.userAId, userId), eq(matches.userBId, userId)),
    ),
    orderBy: desc(matches.startedAt),
  });
  return Promise.all(matchRows.map(m => getMatchState(db, m.matchId, userId)));
}
```

**Backwards-compat:** `GET /v1/match/current` stays. It returns the single active match if there's exactly one; returns 404 if zero; returns the most-recently-created if multiple (for older iOS builds that don't yet understand the list). New iOS code should migrate to `/matches`.

**Acceptance:**
- `GET /v1/matches` returns `[]` when no active matches.
- Returns 1+ entries, each with correct `opponent` field derived from the match.
- Chip totals are per-match, per-user (already the case — `getMatchState` is per-match).

---

### B3: `POST /v1/match` requires `opponent_user_id`

**Body:**
```ts
const createBody = z.object({ opponent_user_id: z.string().uuid() });
```

**`createMatch`:**

```ts
export async function createMatch(db: Database, requestingUserId: string, opponentUserId: string) {
  if (requestingUserId === opponentUserId) throw new Error('Cannot challenge yourself');

  return db.transaction(async (tx) => {
    // Validate opponent exists
    const opp = await tx.query.users.findFirst({ where: eq(users.userId, opponentUserId) });
    if (!opp) throw new Error('Opponent not found');

    // No active match for this pair (either direction)
    const existing = await tx.query.matches.findFirst({
      where: and(
        eq(matches.status, 'active'),
        or(
          and(eq(matches.userAId, requestingUserId), eq(matches.userBId, opponentUserId)),
          and(eq(matches.userAId, opponentUserId), eq(matches.userBId, requestingUserId)),
        ),
      ),
    });
    if (existing) throw new Error('An active match with this opponent already exists');

    const sbOfRound1 = Math.random() < 0.5 ? requestingUserId : opponentUserId;
    const [match] = await tx.insert(matches).values({
      userAId: requestingUserId,     // whoever created it is always user A
      userBId: opponentUserId,
      startingStack: STARTING_STACK,
      blindSmall: BLIND_SMALL,
      blindBig: BLIND_BIG,
      status: 'active',
      sbOfRound1,
      userATotal: STARTING_STACK,
      userBTotal: STARTING_STACK,
    }).returning();

    const roundId = await openRound(tx, match.matchId, 1);
    return { match, roundId };
  });
}
```

Then post-commit dispatch + reminder enqueue (unchanged).

**Note:** `user_a_id` / `user_b_id` no longer need to be in any particular order. Drop the "a < b alphabetically" MVP convention from docs.

**Acceptance:**
- Cannot start match against self.
- Cannot start a second match against an opponent who already has one active.
- Opponent gets `match_started` push (unchanged).

---

### B4: Per-pair match-up

`getMatchUp(db, userId, opponentUserId)` — drop `USER_TJ_ID` / `USER_SL_ID`.

Filter all queries (`computeScoreboard`, `computeHeadToHead`, `computeMoments`, `computePinnedHands`) by the pair:
- `matches.user_a_id IN (userId, opponentUserId) AND matches.user_b_id IN (userId, opponentUserId)`

**Endpoint:** `GET /v1/matchup?opponent_user_id=<uuid>`.

If the user has zero matches against this opponent, return an empty-ish structure (all zeros) with a flag the iOS side uses to show the "play first match" empty state.

**Acceptance:**
- Two different `opponent_user_id` params return two different result sets.
- Backwards-compat: `/v1/matchup` with no query param still works for legacy clients — returns the rivalry against the most-recently-played opponent.

---

### B5: Users roster

**Endpoint:** `GET /v1/users` — everyone signed up, except self.

```ts
app.get('/users', async (req) => {
  const db = getDb();
  const all = await db.query.users.findMany({
    where: ne(users.userId, req.userId),
    orderBy: asc(users.displayName),
  });
  return all.map(u => ({
    user_id: u.userId,
    display_name: u.displayName,
    initials: initials(u.displayName),
  }));
});
```

No email, no Apple sub. Just public identifiers for the opponent picker.

**Acceptance:**
- Returns all users except caller.
- 200 response is just a JSON array.

---

## 4. Sprint C — iOS multi-opponent UI

### C1: Home screen becomes a match list

**New state on Home:**
- `var matches: [MatchState]` (replaces single `matchState`)
- Fetched from `GET /v1/matches`

**Layout (rough):**
- 0 active matches → "No matches in play. Start one." with a CTA.
- 1+ matches → list of `MatchRowCard(match)` — each row shows opponent avatar + name, current round, chips.
- CTA at bottom: "Start a match" → opens the opponent picker (story C2).

Existing per-match body (the `activeMatchView` logic) moves to a `MatchDetailView` drilled into from the list.

**Navigation:** use `NavigationStack` with a `NavigationLink` per row → `MatchDetailView(match)`. The detail view reuses the turn, reveal, coin-flip covers already on `HomeView`.

**AppStore:**
- Rename `matchState` → remove (or keep as the "most recent" for backwards compat during transition).
- Add `matches: [MatchState]` array.
- `refresh()` calls `/v1/matches` and assigns.

**Acceptance:**
- Home empty state → opponent picker → back to Home with 1 row.
- Home with 2+ matches → 2+ rows, each navigable.

---

### C2: Opponent picker sheet

**File:** new `apps/ios/Tilted/Tilted/Views/Home/OpponentPickerSheet.swift`.

Fetches `/v1/users` on open, shows a list of friends, tap to challenge.

```swift
struct OpponentPickerSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var users: [UserSummary] = []
    @State private var isCreating = false
    var onMatchCreated: (MatchState) -> Void

    var body: some View {
        NavigationStack {
            List(users) { u in
                Button {
                    Task { await create(opponentId: u.userId) }
                } label: {
                    HStack {
                        AvatarView(initials: u.initials)
                        Text(u.displayName)
                        Spacer()
                    }
                }
                .disabled(isCreating)
            }
            .navigationTitle("Pick your opponent")
            .task { await load() }
        }
    }

    private func load() async {
        users = (try? await APIClient.shared.listUsers()) ?? []
    }

    private func create(opponentId: String) async {
        isCreating = true
        defer { isCreating = false }
        do {
            let match = try await APIClient.shared.createMatch(opponentId: opponentId)
            onMatchCreated(match)
            dismiss()
        } catch { /* show error */ }
    }
}
```

**APIClient changes:**
- `createMatch(opponentId:)` — takes the id, posts as `opponent_user_id`.
- `listUsers()` — GET `/v1/users`.

**Acceptance:**
- Sheet lists all users (excluding self) with their name + initials.
- Tapping a user creates a match and returns to Home.

---

### C3: Match-up tab opponent selector

Top of `MatchUpView`: a horizontal scrollable pill row, one pill per opponent you've ever played (derived from `/v1/users`, filtered to people you have matches with — or just show everyone and let `getMatchUp` return empty).

- Default: most-recently-played opponent (persisted in `@AppStorage`).
- Tapping a pill re-fires `GET /v1/matchup?opponent_user_id=...`.

**Empty state:** if selected opponent has zero matches with you, show "No history with X yet. Play a match to get started."

**Acceptance:**
- Selector visible when >1 opponent in roster.
- Swapping opponents refreshes the page.
- Selection persists across app launches.

---

### C4: History opponent filter (optional, can defer)

Add a `vs.` filter to `HistoryView`'s existing segmented controls. Straightforward once B4's `opponent_user_id` param is in place.

---

## 5. Cross-cutting / ops

### E1: Rate limit on auth endpoint

`pnpm add @fastify/rate-limit`.

Register a limited version of `authAppleRoutes`:
```ts
await app.register(async (scope) => {
  await scope.register(rateLimit, { max: 5, timeWindow: '1 minute' });
  await scope.register(authAppleRoutes);
}, { prefix: '/v1' });
```

Not applied to the rest of the API.

**Acceptance:**
- 6th SIWA attempt from same IP in <60s gets 429.

---

### E2: Apple revocation webhook

**Endpoint:** `POST /v1/auth/apple/notifications` (no auth — Apple signs the request with its own JWT).

1. Receive Apple's JWT-encoded event (token revocation, account deletion, email update).
2. Verify same way as identity tokens (JWKS).
3. If `events.type === "account-delete"` or `"consent-revoked"`: delete the corresponding `users` row (via same delete path as A6) and invalidate tokens.
4. Return 200.

**This requires the Service ID + key to be configured in Apple Developer** — another manual one-time setup. If not set up, skip this story; Apple doesn't enforce it hard, and the app still works.

**Acceptance:**
- Signed, valid Apple webhook with `account-delete` removes the user.
- Unsigned payload returns 401.

---

### E3: Update docs

Update `CLAUDE.md`:
- Section 1: "N users, 1 match per pair" instead of "2 hardcoded users, 1 match."
- Section 4: remove "MVP is 2 users" from the hardcoding rule. Add: "User identity comes from SIWA; the legacy debug picker is DEBUG-only."

Update `docs/PROJECT-STATE.md`:
- Section 2: replace the hardcoded `USER_TJ_ID` / `USER_SL_ID` section with "auth is SIWA; test users can still log in via debug picker in Xcode Run."
- Section 4: add SIWA + multi-match to the "shipped" list.
- Section 5 quirks: note JWT/JWKS caching.

Update `docs/HLD.md` §5 data model comments: `matches_one_active_idx` unique constraint removed, per-pair scoping.

---

## 6. Migration notes for existing users

TJ and Stephen exist in the DB today with no `apple_sub`. On first SIWA login:
- Apple sends `sub` (stable) and on first login only, `email` + `name`.
- Our server has no way to automatically bind those to the pre-existing rows.
- Simplest path: treat their first SIWA login as a new user. The old `User Thomas Johnston` and `User Stephen Layton` rows become orphans.
- Follow-up cleanup: run the reset-match / DB-wipe after everyone's re-logged in; or keep the orphan rows and ignore.

Not a blocking concern — we reset the DB recently anyway.

---

## 7. Ordering and commit plan

**Single PR, commits per story**, same model as the beta PR. Ordering:

1. A1 (entitlement)
2. A2 (schema migration) — commit migration SQL alongside
3. A3 (server endpoint)
4. A4 (iOS flow)
5. A5 (gate debug picker)
6. A6 (deletion)
7. B1 (drop unique index) — commit migration
8. B2 (per-pair match state + list endpoint)
9. B3 (create requires opponent_user_id)
10. B4 (matchup endpoint per-pair)
11. B5 (users roster)
12. C1 (home → match list)
13. C2 (opponent picker)
14. C3 (match-up selector)
15. C4 (history filter — optional)
16. E1 (rate limit)
17. E2 (revocation webhook — defer if Service ID not configured)
18. E3 (doc sync)

Each commit keeps the tree compilable + passing tests.

---

## 8. Testing strategy

**Server:**
- New unit tests for the Apple JWT verifier (mocked JWKS, hand-signed tokens for happy + bad paths).
- Integration tests for `/v1/auth/apple` — requires spinning up an RSA key, signing a JWT, mocking the JWKS URL.
- Existing match tests still pass after removing hardcoded user IDs.

**iOS:**
- XCTest for `AppStore.signInWithApple` — inject a fake APIClient, assert state transitions.
- Previews for `SignInView`, `OpponentPickerSheet`, multi-match Home.

**Manual:**
- TestFlight install → fresh device → SIWA modal → Home.
- Two users, one on Apple account A, one on Apple account B → challenge → play → see match-up populate for both.
- Delete account → confirm row + children gone from DB.

---

*End of spec.*

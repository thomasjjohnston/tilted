# App Store launch log

Running record of the App Store launch work: what shipped, decisions made on
TJ's behalf (he authorised deciding spec ambiguities and logging them here),
and anything skipped. Newest entries at the bottom.

## Standing rules

- No user or match history is ever lost. A verified local dump of production
  is taken before every migration or data change (kept outside the repo).
- Contact address everywhere: `tilted.admin@gmail.com`.

## Shipped

| Date | Item | PR | Notes |
|---|---|---|---|
| 2026-10-02 | A1 Debug login closed in production | #27 | Route only exists when `ENABLE_DEBUG_AUTH=true`. Verified: production returns route-not-found. |
| 2026-10-02 | B5 Bot branches merged | #23–#26 | Migrations 0005/0006 applied. Bot is still gated (`TILTED_BOT_TESTERS` unset) and has no strategies in production yet. |
| 2026-10-02 | A2 Account deletion keeps opponent history | #28 | Migration 0007. Verified: production rows unchanged after deploy. |
| 2026-10-02 | A3 Sign-out revokes the bearer; idle tokens expire | #29 | Migration 0008. Verified in production. |
| 2026-10-02 | A4 Release build config | #30 | ATS debug-only, iPhone only, real version in Settings, Gmail feedback address. |
| 2026-10-02 | A5 Generated names for hidden Apple names | #31 | Word lists in `apps/server/src/lib/player-names.ts`. |
| 2026-10-02 | B6 Play-the-bot endpoint | #32 | `GET /v1/bot`, `POST /v1/match/bot`, `opponent.is_bot`. Server only; the iOS button comes with the new-game screen in section C. |
| 2026-10-02 | B9 Bot retry sweep | #33 | Every 60s and at startup; pinging the bot also triggers its turn. |
| 2026-10-02 | C10 Invites: create and redeem | #34 | Migration 0009 (new table). |
| 2026-10-02 | C11 Invite landing page + universal-link file | #35 | `GET /i/:code`, `GET /.well-known/apple-app-site-association`. |
| 2026-10-02 | C12 Rematch-only challenges; global roster removed | #36 | `GET /v1/opponents`; `POST /v1/match` needs a prior match. |
| 2026-10-02 | C14 Block a player (server) | #37 | Migration 0010 (new table). TJ chose: blocking ends the active match as abandoned. |
| 2026-10-02 | B10 Bot turn fitted to the shared stack (bug fix) | #38 | Found by playing the bot on a local stack with the pilot strategies. |
| 2026-10-02 | C13 iOS: new-game screen, invite links, block/unblock | #39 | Replaces the opponent picker. Needs the Associated Domains capability on the App ID. |
| 2026-10-02 | E15 Privacy policy and support pages | #40 | `/privacy`, `/support`; linked from Settings and the sign-in screen. **TJ to review the policy text before App Store submission.** |
| 2026-10-02 | E16 Privacy manifest + label answer sheet | #42 | `PrivacyInfo.xcprivacy`; `docs/APP-STORE-PRIVACY-LABELS.md`. |
| 2026-10-02 | F22 One Fly machine always on | #41 | Verified: machine started, reminder loop logged at boot. |
| 2026-10-02 | D13 How-to-play explainer | #43 | Four cards; last card starts a bot match or an invite. Shown once per device; again from Settings. |

## Decisions made without asking

1. **Debug login switch is a dedicated flag, not `NODE_ENV`** — the local
   docker-compose stack runs the production image, so `NODE_ENV` could not
   tell local from Fly.
2. **Bot PRs merged before the account-deletion change** — both add
   migrations and the bot's were numbered first.
3. **Deleted users keep a scrubbed row named "Deleted Player"** rather than
   being re-pointed at one shared placeholder user, so per-opponent history
   and head-to-head stats stay separable.
4. **A deleting user's own pinned hands are removed; the opponent's pins on
   the same hands stay.**
5. **`app_events` rows for a deleted user are kept**, keyed by the scrubbed
   user id. They hold event kinds and ids, no names or emails.
6. **Abandoned matches move no chips and record no winner**, and are excluded
   from the head-to-head match score.
7. **A retried round-advance on an `ended` match stays idempotent**; only
   `abandoned` matches reject it.
8. **Token expiry is sliding, 90 idle days.** Any use resets the clock, so
   active players are never signed out; an abandoned or leaked token dies.
   Existing tokens start their clock at the migration.
9. **Sign-out revokes only the token on that device**, not the user's other
   sessions.
10. **Four one-line iOS release settings went in one PR** (ATS, iPhone-only,
    version display, feedback address) rather than four, since each is a
    config line and they share one build verification.
11. **Generated names look like "Lucky Gutshot 7" or "River Rat 42"**, are
    assigned once at sign-up, and are not unique. The email-prefix fallback
    is gone, since it showed part of the user's address to opponents.
12. **The bot is offered only when it can play**: bot user exists, strategies
    are imported, and the user passes the `TILTED_BOT_TESTERS` gate. The gate
    is kept as an off switch; opening the bot to everyone is the Fly secret
    `TILTED_BOT_TESTERS=*`, set when strategies are in production.
13. **`POST /v1/match/bot` takes no body**; the server picks the bot user, so
    the client never needs a bot id.
14. **Bot retry is a 60-second in-process sweep plus ping-to-retry**, not a
    queue. It only runs while the Fly machine is awake, which is fine: any
    request from the waiting player wakes it, and the sweep also runs at
    startup.
15. **Invites are single-use, 7 days, 8-character codes** from an alphabet
    without 0/O/1/I/L. A player may hold any number of open invites.
16. **Redeeming when the pair already has an active match is refused but does
    not burn the invite.**
17. **Redeem is rate-limited to 30 requests a minute per user** to stop code
    guessing.
18. **The invite's "new match" push goes to the inviter**, sent as if from
    the redeemer ("New match! Bob dealt round 1").
19. **The public invite page shows only the inviter's first name, the code
    and the expiry date.** Dead or unknown codes show a generic message and
    no name. No scripts, cookies or external assets.
20. **The install button needs `APP_STORE_URL`** (Fly secret) once the app is
    live; until then the page says the app is coming soon.
21. **`GET /v1/users` is kept as a deprecated alias of the rematch list**
    rather than deleted, so the 0.1.7 TestFlight build's opponent picker
    still works for people you have already played. It no longer shows
    strangers.
22. **A stranger and a non-existent user get the same 404** from
    `POST /v1/match`, so user ids cannot be probed.
23. **You can only block someone you have a match with**, so blocking cannot
    be used to test whether a user id exists.
24. **A blocked player sees the opponent vanish from their rematch list** and
    the abandoned match leave their active list, with no message. The
    alternative (keep showing them, fail on tap) seemed more confusing.
25. **Block has no `client_tx_id`**: it is keyed on the pair, so a retry is
    naturally a no-op.
26. **When the bot's ten choices exceed its stack**, hands that keep chips
    behind are played first in order, a raise that no longer fits becomes a
    call (never an accidental shove), and at most one all-in goes last with
    whatever is left; anything still unaffordable checks or folds.
27. **With zero chips left and facing a bet, the bot folds** rather than
    going "all-in for nothing", matching the app's auto check/fold for humans.
28. **One "New game" sheet** holds all four ways to start: play the bot,
    invite a friend (share sheet), enter a code, rematch. Blocking is a
    swipe or long-press on a rematch row, or a long-press on a Home match
    card; unblocking lives in Settings → Blocked players.
29. **A tapped invite link is redeemed as soon as the user is signed in**, with
    no confirmation step (TJ: instant start). The code is kept across sign-in
    and relaunch, and dropped on an explicit sign-out.
30. **Debug builds accept launch arguments** (`-debugUserId`, `-debugScreen`)
    so the simulator can be driven without an Apple ID; compiled out of
    Release.
31. **The privacy policy is written in plain language as a first draft** and
    states: Sign in with Apple identifiers/name/email, gameplay data, push
    token, invites/blocks, usage events; no selling, ads or analytics SDKs;
    US hosting on Fly.io and Neon; deletion in app; hands kept under
    "Deleted Player"; rated for adults. TJ must read it before it is cited
    on the App Store listing.
32. **The explainer is shown once per device, not per account**, and is
    skipped when the app was opened from an invite link (the invite takes
    precedence; they can read it later from Settings → How to play).
33. **"Play Untilted" on the last card starts the bot match directly**; if
    the bot is unavailable it falls back to the New game sheet.

## Open items for TJ

- **Read `https://tilted-server.fly.dev/privacy`** and tell me any changes.
  It is cited in the listing and shown in the app.

- **Associated Domains capability**: the app now declares
  `applinks:tilted-server.fly.dev`. Xcode's automatic signing usually adds
  the capability to the App ID on the next archive; if the archive fails
  with an entitlement error, enable "Associated Domains" on the App ID in
  the Developer portal.

- **DECISION NEEDED — where the bot's strategies live.** The trained
  artifact (`tools/solver/runs/best`) is 42.2M rows / 6.6 GB as SQLite.
  Measured on a 2M-row sample, it would be about 37M rows and 7–8 GB in
  Postgres after the importer's low-visit pruning. Production's database is
  14 MB today. Options:
  1. Pay for Neon storage (check the plan: free tier is 0.5 GB). Simple, no
     code change; backups must exclude the strategy tables.
  2. Ship the artifact as a read-only SQLite file on a Fly volume and read it
     from the server. Cheapest storage; needs a new reader and a dependency.
  3. Import a smaller set (fewer stack depths or harsher pruning) so it fits
     a small database, at some cost to bot strength.
  Until this is decided the bot stays unavailable in production: the
  endpoint, retry and tests are in place, the data is not.

- App Store Connect Issuer ID (needed for build upload).
- Confirm the app record, the Service ID for the Apple revocation webhook,
  and the Gmail inbox exist.
- PR #19 (`feat/social-batch`, chat + show cards) is open and not in the
  launch plan. Left untouched.
- The repo lives in an iCloud-synced `Documents` folder; switching branches
  makes iCloud create duplicate files such as `bot 2.ts`. 47 byte-identical
  duplicates were removed on 2026-10-02. Moving the repo out of `Documents`
  would stop this.

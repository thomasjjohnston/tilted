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
| 2026-10-02 | B6 Play-the-bot endpoint | (pending) | `GET /v1/bot`, `POST /v1/match/bot`, `opponent.is_bot`. Server only; the iOS button comes with the new-game screen in section C. |

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

## Open items for TJ

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

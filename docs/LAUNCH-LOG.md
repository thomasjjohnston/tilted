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
| 2026-10-02 | A2 Account deletion keeps opponent history | (this PR) | Migration 0007. |

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

## Open items for TJ

- App Store Connect Issuer ID (needed for build upload).
- Confirm the app record, the Service ID for the Apple revocation webhook,
  and the Gmail inbox exist.
- PR #19 (`feat/social-batch`, chat + show cards) is open and not in the
  launch plan. Left untouched.
- The repo lives in an iCloud-synced `Documents` folder; switching branches
  makes iCloud create duplicate files such as `bot 2.ts`. 47 byte-identical
  duplicates were removed on 2026-10-02. Moving the repo out of `Documents`
  would stop this.

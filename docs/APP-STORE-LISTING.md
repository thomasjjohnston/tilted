# App Store listing

Everything that goes into App Store Connect for the 1.0 submission. Written
so it can be pasted field by field. Keep in step with the privacy policy
(`/privacy`), the privacy labels (`APP-STORE-PRIVACY-LABELS.md`) and the
privacy manifest.

## App information

| Field | Value |
|---|---|
| Name | Tilted |
| Subtitle (30 chars max) | Ten hands. One stack. Poker. |
| Bundle ID | com.thomasjjohnston.tilted |
| SKU | tilted-ios |
| Primary category | Games |
| Secondary category | Card (Games subcategory) |
| Content rights | Does not contain, show, or access third-party content |
| Age rating | See below |
| Price | Free |
| Availability | United States only |
| Devices | iPhone only |

## Age rating questionnaire

Answer **None** to everything except:

| Question | Answer |
|---|---|
| Simulated Gambling | **Frequent/Intense** (it is a poker game; chips have no value) |
| Contests | None |
| Unrestricted Web Access | No |
| Gambling (real money) | No |

Expect a 17+ rating. The description says plainly that no real money or
prizes are involved.

## Version information

**Promotional text** (170 chars, can change without a new build):

> Heads-up Texas Hold'em with a friend, ten hands at a time, all drawing from one stack. Play chips only. Take your turn when you have a minute.

**Description:**

> Tilted is heads-up Texas Hold'em between two friends, with a twist: you're dealt ten hands at once, and every chip you put into any of them comes out of the same stack.
>
> Bet big on one hand and you have less for the other nine. Fold the junk, press the good ones, and watch what your friend does with theirs. It's poker as a conversation that lasts all week.
>
> HOW IT WORKS
> • Invite a friend with a link. The match starts the moment they open it.
> • Each round deals ten hands between you. You both start with 2,000 chips.
> • Take your turn in every hand that's waiting on you, then send them all at once.
> • Get a notification when it's your turn. No clock, no pressure.
> • The match ends when one of you runs out of chips. Then play again.
>
> NO FRIEND HANDY?
> Play Untilted, the house bot. It answers instantly and never gets tired.
>
> KEEP THE GOOD ONES
> Every hand you've played is in your history. Pin the coolers, the bad beats and the hero calls, and relive them on the Match-up page.
>
> PLAY CHIPS ONLY
> Tilted uses play chips with no cash value. There is no real-money gambling, no purchases, and no prizes.
>
> Sign in with Apple. No ads, no tracking.

**Keywords** (100 chars max, comma-separated, no spaces):

> poker,holdem,texas,heads up,friends,turn based,async,card game,play chips,bot

**Support URL:** https://tilted-server.fly.dev/support
**Marketing URL:** (leave blank)
**Privacy Policy URL:** https://tilted-server.fly.dev/privacy
**Copyright:** 2026 Thomas Johnston

**What's New (1.0):**

> First release.

## Screenshots

Required set: 6.9" iPhone (iPhone 17 Pro Max class), portrait, 1320 × 2868.
Captured 2026-10-02 into `docs/screenshots/appstore/` from a Debug build on
the simulator against the local stack loaded with a copy of production data
and **fictional opponent names** (no real names appear):

1. `01-home.png` — Home with three matches (Untilted, two friends), one with Ping.
2. `02-turn.png` — the turn screen: ten hands, two decided, cart at the bottom.
3. `03-match-up.png` — Match-up vs a friend: 14–14 record, moments, head to head, pinned hands.
4. `04-new-game.png` — the New game sheet (bot, invite, code, rematch).
5. `05-how-to-play.png` — first how-to-play card.

Upload as-is (no captions) for the first submission. A showdown-result
screenshot would be a good sixth once one is captured by hand.

Caption ideas (overlaid or not): "Ten hands at once." / "One stack for all
of them." / "Play when you have a minute." / "Relive the coolers." /
"Invite a friend, or play the bot."

## App Review information

| Field | Value |
|---|---|
| Sign-in required | Yes (Sign in with Apple). No demo account: see notes. |
| Contact first/last name | Thomas Johnston |
| Contact phone | (TJ to fill) |
| Contact email | tilted.admin@gmail.com |

**Notes for the reviewer:**

> Tilted is a two-player poker game played with play chips only. There is no real-money gambling, no in-app purchase, and no prizes of any kind.
>
> To play without a second person: sign in with any Apple ID, tap through the short "How to play" cards, and choose "Play Untilted, the house bot" (also available from Start a match → Play Untilted). The bot answers instantly, so a complete match can be played from one device.
>
> Players can only start a match with someone they have invited (by a link they share themselves), someone they have already played, or the bot. There is no public list of players and no search. Players see each other's display names only. Any player can block another (press and hold a match on Home, or swipe in the New game list); blocking ends the match and prevents further contact, and can be undone in Settings → Blocked players. Account deletion is in Settings → Delete Account and removes the user's personal data immediately.
>
> The app uses Sign in with Apple only, requests notification permission for turn alerts, and accesses nothing else on the device.

## TestFlight

**Beta App Description:**

> Heads-up Texas Hold'em with a friend, ten hands at once off one shared stack. Play chips only. Invite a friend with a link, or play the house bot.

**What to Test** (per build):

> 1. Sign in, read the How to play cards, and start a match against Untilted.
> 2. Invite a friend by text and play a full match with them.
> 3. Tell us anything confusing, especially around the shared stack.

**Feedback email:** tilted.admin@gmail.com
**License agreement:** standard.

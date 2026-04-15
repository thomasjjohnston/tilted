# Tilted — Product Definition (MVP)

**Owner:** TJ
**Status:** Draft v0.1 — for engineering design & sprint planning
**Platform:** iOS (iPhone), native
**Scope:** MVP — a two-player experimental build for the creator (TJ) and one friend. The purpose of MVP is to validate the core loop and gather qualitative feedback; rules are expected to change.

---

## 1. Product summary

Tilted is an asynchronous, heads-up Texas Hold'em iPhone game for two friends. Instead of sitting down for a long session, the two players play ten hands in parallel against each other. A player's **turn** is "act in every hand where it's on you"; only once every pending hand has been advanced does control pass to the opponent. The design target is the poker-loving professional who doesn't have an uninterrupted hour but does have five free minutes at a time.

The core creative bet is that running ten hands simultaneously — off a single shared chip stack — produces poker decisions you can't get from a normal table. You're forced to allocate a finite bankroll across ten concurrent spots, which turns routine decisions (call vs. fold, bet sizing) into portfolio decisions. Hand summaries are a first-class feature: the two players should be able to revisit, favorite, and screenshot any hand they've played together.

## 2. Goals & non-goals

### Goals (MVP)

- Ship a playable build for exactly two hardcoded users (TJ + friend).
- Prove the core async-parallel loop is fun and comprehensible.
- Produce a hand history rich enough to reminisce, bookmark, and discuss.
- Be cheap to change: rules will get rewritten based on play feedback.

### Non-goals (explicitly out of scope for MVP)

- Onboarding, sign-up, or account discovery flows beyond two hardcoded accounts.
- Matchmaking, multiple opponents, friends lists, social graph.
- Real money, purchases, cosmetics, or any monetization.
- Tournaments, sit-and-gos, multi-table, >2 players.
- Android, iPad, web client.
- Anti-cheat beyond basic server authority.
- In-app chat, voice, video.
- Localization beyond English.
- Accessibility polish beyond Apple defaults (will address post-MVP).
- Deep analytics dashboards. Minimal event logging only.

## 3. Core concepts & glossary

| Term | Definition |
|---|---|
| **Match** | A single head-to-head contest between the two users, starting with fresh 2000-chip stacks. Ends when a player busts. |
| **Round** | A batch of exactly 10 hands played in parallel. A new round only begins once every hand from the previous round has resolved. |
| **Hand** | A single instance of heads-up Texas Hold'em. 10 hands run concurrently per round. |
| **Turn** | The interval during which it is one player's responsibility to act. A turn ends when that player has made a legal action in every pending hand where action is on them. |
| **Turn-cycle** | One full exchange: Player A's turn, then Player B's turn. A hand may require many turn-cycles (preflop raise, 3-bet, 4-bet, flop bet, flop raise, etc.). |
| **Total stack** | A player's current chip count including both available and reserved chips. |
| **Available chips** | Chips not currently committed to any pot. Only these can be used to post blinds or make new bets. |
| **Reserved chips** | Chips committed to pots of currently-active hands. Locked until each hand resolves. |
| **Favorited hand** | A hand a player has bookmarked; appears in a filterable list in History. |

## 4. Match lifecycle

1. Either player starts a new match from the home screen. A match requires both players to have zero active matches (MVP: one match at a time).
2. Both players receive a **2000 chip** starting stack.
3. A coin flip determines who is the Small Blind for round 1. This is persisted and visible in the match header.
4. Round 1 begins: 10 hands are dealt simultaneously.
5. Rounds continue sequentially until **bust**: at a round boundary, if either player's total stack is less than the chips required to post blinds for the next round as Big Blind (10 × BB = 100 chips), the match ends and the other player wins.
6. Match result is recorded permanently in History. A new match can be started immediately.

### Why "bust at round boundary" and not mid-round

A player's total stack can dip during a round because chips are reserved to pots, but those chips may come back as winnings when hands resolve. Evaluating bust only at round boundaries uses each player's true settled stack and avoids spurious match-end mid-round.

## 5. Round lifecycle

1. At round start, the 10 hands are dealt simultaneously. All 10 hands in the round share the same position assignment — if Player A is SB/Button, A is SB/Button in all 10 hands; B is BB in all 10.
2. Position flips between rounds: if A was SB in round N, A is BB in round N+1.
3. Blinds are posted atomically at round start for all 10 hands:
   - SB player has `10 × 5 = 50` chips moved from Available to Reserved across the 10 hands' pots.
   - BB player has `10 × 10 = 100` chips moved from Available to Reserved across the 10 hands' pots.
4. All 10 hands enter the preflop betting street. Action is on the SB (standard HU preflop order).
5. Play proceeds in **turns** (see §6).
6. A round ends only when every one of the 10 hands has reached a terminal state (folded, or showdown resolved, or all-in runout completed).
7. Once the round ends, any pending all-in runouts are revealed in a batch (see §10). Winnings are distributed. Reserved chips return to available.
8. Round summary is written. A new round is dealt.

## 6. Turn model (the async core)

The turn is the central UX primitive. A precise definition:

> A **turn** belongs to the player who has at least one pending action anywhere in the active round. During their turn, they must make a legal action in every hand where the action is currently on them. Once they have no more pending hands, control passes to their opponent.

Concretely:

- At round start, the SB has 10 pending preflop actions. It is SB's turn.
- When SB has acted in all 10 (some may have folded, some called, some raised), the turn passes.
  - If SB folds in a hand, that hand is terminal — no further action in that hand.
  - If SB calls in a hand, action passes to BB in that hand (BB may check or raise preflop since SB only completed — see betting rules below).
  - If SB raises in a hand, action passes to BB to fold/call/re-raise.
- BB now has pending actions in every hand where SB did not fold. BB's turn begins.
- BB acts in all pending hands. Turn passes back.
- This continues until, within each hand, the betting street is closed, at which point community cards deal automatically and the next street's action order is applied (on the flop/turn/river, BB acts first in HU).
- A single hand may require many turn-cycles (re-raise wars preflop, bet-raise-call sequences on each street). That's fine — turn-cycles apply per-hand and the round waits for all 10 to finish.

### Turn handoff notifications

A single push notification is delivered to a player when control passes to them. No in-turn reminders, no escalating nudges, no deadlines in MVP. The push payload names the opponent and the count of pending hands.

### No deadlines

A player can take arbitrarily long. The two-user trust model makes this acceptable for MVP. A future version will introduce deadlines and auto-actions.

## 7. Chip economy (the mechanical innovation)

The defining rule: **a player has a single pile of chips shared across all 10 hands.** Chips committed to a pot in one hand are unavailable in the others until that hand resolves.

### State per player

- `total_chips` — the player's real bankroll. Changes only when a hand resolves (winnings) or is lost.
- `reserved_chips` — sum of the player's chips currently sitting in active hand pots. Derived field; `reserved = Σ player_contribution_to_each_active_pot`.
- `available_chips = total_chips − reserved_chips`.

### Rules

- **Posting a blind** moves chips from available to reserved.
- **Making a bet / call / raise** moves chips from available to reserved.
- **Winning a hand** moves the pot (both players' reserved chips for that hand) to the winner's available.
- **Losing a hand** forfeits the reserved chips to the opponent.
- **Tie (split pot at showdown)** returns each player's contribution proportionally (standard HU split).
- The maximum a player can commit in a given hand is their current `available_chips` PLUS whatever they already have reserved in that same hand. (You cannot double-spend chips reserved in another hand.)
- If a player faces a bet they cannot cover with available chips, they are short-stacked for that hand. They may call "for less" (standard all-in short-call rule): the excess bet is returned to the bettor, and the hand proceeds with the capped pot. Side pots are not possible in HU.

### Worked example

Player A has `total = 2000`. Round opens; A is SB. A posts `10 × 5 = 50` in blinds. A now has `reserved = 50, available = 1950`.

A raises to 200 in hand 1 (committing 195 more). A now has `reserved = 245 (200 in hand 1 + 5×9 in the other 9 SB posts), available = 1755`.

Before A acts in the other 9 hands, A sees an effective stack of 1755 available plus whatever is already reserved in each respective hand (5 chips per hand). So the max A could jam in hand 2 is `1755 + 5 = 1760`.

A jams hand 2 for 1760. Now `reserved = 2000, available = 0`. A must now play the remaining 8 hands with zero new-bet capability: A can only fold (or check if facing no bet — but as SB preflop, A must act; A's options are fold or complete-the-small-blind-for-5 using the already-reserved blind, which requires no additional chips).

Wait — the reserved 5-chip SB posts count as already-committed to each respective pot. In HU preflop, the SB can limp (call to match BB) by adding 5 more chips, or fold, or raise. If A has 0 available, A cannot limp; A must fold the remaining 8 hands.

This is the strategic engine of the game: stack allocation is a finite-budget problem.

### Implementation note

Reserved chips must be computed from an authoritative source (the hand states on the server), never stored independently. The client displays it but does not source-of-truth it. All bets are validated server-side against `available_chips` at the moment of action.

## 8. Position & blinds

- Position is a round-level property. Within a round, all 10 hands have identical position: one player is SB/Button for all 10, the other is BB for all 10.
- Position flips each round.
- Blinds are fixed at **5 / 10** for the entire MVP. No escalation.
- The Button / SB always acts first preflop and second on every postflop street (standard HU rules).

## 9. Betting rules & controls

Standard Texas Hold'em, heads-up.

### Actions

- **Fold** — hand terminal, opponent wins pot.
- **Check** — only when no bet is facing you; passes action.
- **Call** — match the current bet.
- **Bet** / **Raise** — place a new wager. Min bet = 1 BB = 10. Min raise = at least the size of the previous bet/raise (standard min-raise rule). Max = `available + already_reserved_in_this_hand`.
- **All-in** — bet all available + already-reserved-in-this-hand chips. If facing a bet larger than you can cover, you go all-in for less and excess is returned to bettor.

### Bet input UI

A bet-sizing sheet with:

- Quick buttons: `½ pot`, `⅔ pot`, `Pot`, `All-in`.
- A slider covering the legal range (`min_raise` to `max`).
- A numeric readout with +/- tap increments (10-chip increments).
- A readout of "After this bet, you will have X available" to make cross-hand cost explicit.
- Server-side validation is authoritative; client-side validation is a UX aid only.

### No quick-apply across hands in MVP

Each hand's action is entered individually. A "same size in all hands" toggle was considered and deferred post-MVP.

## 10. All-in hands & end-of-round reveal

When both players are all-in in a hand (no further action possible), the hand **freezes**:

- No further community cards are dealt for that hand until end of round.
- Reserved chips stay reserved.
- The hand is marked "awaiting runout" in the UI.
- The round does NOT advance to completion on that hand's account — it counts as resolved for turn-taking (no pending actions).

When all 10 hands are in terminal or frozen state, the round enters **reveal**:

1. Any frozen all-in hands have remaining community cards dealt (turn/river as needed).
2. The app plays a sequential reveal animation across all frozen hands (one after another, roughly 2–3 seconds each).
3. Winner determined per hand. Chips move from reserved to winner's available.
4. Round summary is generated.
5. A new round begins after the user taps "Next round" (not automatic — forces acknowledgment of the reveal).

Both players see the reveal next time they open the app. If one opens the app before the other, they see the runout; there is no "wait for opponent to watch" step.

## 11. Showdown & mucking

- A hand reaches showdown only when the river's betting is complete with at least one caller.
- Both players' hole cards are revealed and stored in the hand record.
- The losing player's cards are revealed and stored regardless (no muck-hide option in MVP — transparency is more valuable than etiquette at two users).
- Folded hands never reveal the folder's hole cards, either in real-time or in summaries. Those hole cards are discarded from the persisted record. (This preserves the bluff / information asymmetry that makes poker work.)

## 12. Hand summaries

Hand summaries are a first-class feature — possibly the most-used surface in the app outside of acting. Every completed hand generates both a **summary card** and a **detailed replay**.

### Summary card (always visible in feed)

Compact tile with:

- Hand number within match (e.g., "Match 3, Round 7, Hand 4").
- Both players' hole cards (if shown; "Mucked" if folded preflop pre-reveal).
- The final board (up to 5 cards).
- Final pot size.
- Winner and amount won.
- A one-line action sketch (e.g., "SB raised, BB 3-bet, SB called; flop checked, turn jam called — BB wins 420").
- Favorite toggle (star icon).

### Detailed replay

Opened from the summary card. Shows:

- Step-by-step action log: every bet, raise, check, fold with pot size after each action and each player's remaining available/reserved at that moment.
- Street separators with community cards revealing at the correct moment.
- Relative timestamps (e.g., "BB acted 4h after SB").
- Both players' hole cards (subject to §11 mucking rules).
- A scrubber to replay the hand step-by-step.
- Favorite toggle (mirrors the summary card).
- "Take a screenshot" is not a built feature — users use iOS system screenshot, which is why the replay view is designed to be screenshot-friendly (high contrast, all key data on one screen if possible).

### Favoriting

Either player can favorite any hand. Favorites are per-user (my favorites are not the opponent's favorites). Favorites are filterable in the History screen.

### No in-app comments, no share sheet in MVP

Deferred. Users can take iOS screenshots and share via iMessage. Favorite + screenshot covers the MVP requirement.

## 13. UI / screens

### 13.1 Home / dashboard

The default landing screen.

- Match header: opponent name, my total stack, opponent's total stack, "You are: SB / BB this round."
- Round status: "Round 7 · 3 of 10 hands awaiting your action."
- Primary CTA: "Take your turn" (or "Waiting on [opponent]" disabled state).
- Secondary: Match history, Favorites, Settings (mostly empty in MVP).

If there is no active match, the CTA is "Start new match."

### 13.2 Turn view (playing your turn)

Entered by tapping "Take your turn."

- A vertically scrolling stack of **hand cards** — one per pending hand.
- Each hand card shows: hand number, your hole cards, current board (if any), pot size, current bet facing you, your available chips, your reserved-in-this-hand chips, the action buttons (Fold / Check / Call / Bet-Raise).
- Hands that are not pending your action (because you already acted or they're terminal) are still visible but collapsed/greyed.
- A sticky header shows: "X of 10 hands left in your turn."
- When you act on a hand, it animates to a "done" state and auto-scrolls to the next pending hand.
- After the last pending hand is acted on, a full-screen confirmation appears: "Turn sent. Waiting on [opponent]."

### 13.3 Bet/raise sheet

Modal bottom sheet (see §9).

### 13.4 Round reveal

Triggered when all 10 hands are terminal and any frozen all-ins need runout.

- Full-screen animation reveals each all-in runout in sequence.
- Summary: "Round 7 complete — you won 340 chips net this round."
- CTA: "Next round."

### 13.5 Hand summary card (in feed)

As specified in §12.

### 13.6 Detailed replay

As specified in §12.

### 13.7 History

- Filter: All hands / Favorites only.
- Filter: Won / Lost / All.
- Filter: By match, by round.
- Default sort: most recent first.

### 13.8 Settings (very thin for MVP)

- Notification toggle (push on/off).
- Sign-out (restricted — MVP hardcoded accounts; button shown but acts as "reset match" for testing).
- App version / build.

## 14. Data model (reference for engineering)

A sketch, not authoritative; schema to be finalized in design.

- **User** — `user_id`, `display_name`, `apns_token`.
- **Match** — `match_id`, `user_a_id`, `user_b_id`, `starting_stack`, `blind_small`, `blind_big`, `current_round_id`, `status` (active / ended), `winner_user_id`, `started_at`, `ended_at`.
- **Round** — `round_id`, `match_id`, `round_index`, `sb_user_id`, `bb_user_id`, `status` (dealing / in_progress / revealing / complete), `created_at`, `completed_at`.
- **Hand** — `hand_id`, `round_id`, `hand_index` (0–9), `deck_seed`, `board` (array up to 5 cards), `user_a_hole`, `user_b_hole`, `pot`, `status` (preflop / flop / turn / river / awaiting_runout / complete), `terminal_reason` (fold / showdown), `winner_user_id`, `completed_at`.
- **Action** — `action_id`, `hand_id`, `acting_user_id`, `street` (preflop / flop / turn / river), `action_type` (fold / check / call / bet / raise / all_in), `amount`, `pot_after`, `client_sent_at`, `server_recorded_at`.
- **Favorite** — `user_id`, `hand_id`, `created_at`.

### Invariants the server must enforce

- A player's total committed chips across all active hands must never exceed `total_chips`.
- An action is only accepted if it is currently that player's turn to act in that hand.
- The round cannot advance to "complete" until all 10 hands are terminal.
- Deck seeds are generated server-side and never exposed to either client until cards are dealt.

## 15. Authentication & pairing (MVP)

- **Two hardcoded accounts.** Two user records exist from day one; the only way to "sign in" is to launch the appropriate build (or pick from a two-item list on a debug screen).
- No invite flows, no onboarding, no email/SMS. This is explicitly a throwaway pairing scheme to be replaced post-MVP.
- Push tokens are registered automatically on first launch if the user allows notifications.

## 16. Notifications

- Apple Push Notification Service.
- One notification per turn handoff, delivered to the player whose turn just began.
- Payload: `"{opponent} finished their turn. {N} hands are waiting for you."`
- Tap opens directly into the Turn view.
- No other push types in MVP (no match-end push, no round-complete push).

## 17. Edge cases & rules clarifications

- **Both fold in the same round, same turn?** Not possible — only one player acts per turn.
- **Hand terminates preflop with SB's fold.** BB wins the pot (the SB's posted blind and nothing more beyond what's in there — 5 chips). Standard.
- **Simultaneous connection loss.** The game is fully turn-based with server authority. Reconnects see the current state.
- **Bet slider jumps past legal min-raise.** Client snaps to min-raise; server rejects anything illegal.
- **Ties (chopped pots).** Contributions split evenly. For odd chips, award the odd chip to out-of-position player (standard HU).
- **Running out of chips mid-round.** Possible. Player may have zero available and still owe a blind post in the next round — handled at the round boundary (bust check).
- **What if you jam hand 1 for 2000 before posting the other 9 SBs?** Blinds are posted atomically at round start, BEFORE any player action. So all 10 SBs are posted before you can act in any hand. Available after blinds = `2000 − 50 = 1950`, and any in-hand action works off that.
- **Can I see my opponent's remaining available chips live?** Yes — both totals and available/reserved are visible to both players at all times. No hidden information beyond hole cards.
- **Can I change my action after submitting?** No. Actions are final on submit. An "Are you sure?" confirmation appears for all-in actions.

## 18. Feedback loop (the MVP is an experiment)

Because this is explicitly experimental:

- In-app: a small "Send feedback" button in Settings that composes an email to a fixed address.
- The two users are expected to talk out of band. The app does not need in-app feedback capture beyond the button.
- **Minimal event logging** (server-side): turn submitted, hand completed, round completed, match ended, favorite added, app session started. These feed a simple dashboard for qualitative judgment calls like "is anyone actually favoriting hands?"

## 19. Success criteria for MVP

The MVP is successful if, after two weeks of play, both of the following are true:

1. Both users have voluntarily initiated at least one new match after the first bust.
2. At least ten hands across the two users have been favorited, and both users can articulate one memorable hand without looking at the app.

A secondary (not required) signal: both users express unprompted preferences about rule changes. That's the real payoff of v0.

## 20. Open questions for post-MVP

Not blockers for v0 but worth capturing:

- Should there be deadlines / auto-actions on turns? (Almost certainly yes once we move past two trusted users.)
- Chip allocation UI: would a visible "allocation bar" showing how much of your stack is committed to each active hand help or hurt?
- Rake / table economics if this ever becomes more than two players.
- Should all-in runouts happen immediately per-hand or at end of round? Current decision: end of round, for drama. Gather feedback.
- "Same-size-to-all" quick apply for bet sizing when making the same decision across multiple hands.
- Multi-opponent matches (run one match with three friends simultaneously?).
- Variable hand-count per round (5, 10, 20). Is 10 actually the sweet spot?
- Match templates (different blind structures, different starting stacks).
- Tournament mode (escalating blinds).
- Hand sharing outside the two-person graph.

## 21. Sprint-ready breakdown (suggested)

Offered as a starting point for the implementing engineer.

1. **Sprint 0 — Foundations.** iOS project setup, server skeleton (authoritative game logic), two hardcoded user accounts, APNS wiring, minimal auth.
2. **Sprint 1 — Core poker engine.** Server-side HU Hold'em hand evaluator, deck/dealer, action validation, showdown resolution. Fully unit-tested, no UI.
3. **Sprint 2 — Parallel round mechanics.** Round of 10 hands, shared chip pool, reserved/available accounting, turn handoff logic, server-authoritative state machine.
4. **Sprint 3 — Turn view & bet sheet.** The primary play surface. Scrollable hand cards, bet input, server integration.
5. **Sprint 4 — Round reveal & hand summaries.** End-of-round animation, summary cards in feed, detailed replay view.
6. **Sprint 5 — History, favorites, notifications, polish.** Filterable history, favorite toggle, push notification on turn handoff, settings screen, feedback email.
7. **Sprint 6 — Hardening.** Edge cases from §17, reconnect handling, TestFlight build for TJ and friend.

---

*End of document. Open items and rule ambiguities should be raised against this document so v0.2 can capture them before implementation begins.*

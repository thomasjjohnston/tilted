# Hand Completion Pages — Implementation Spec

**Status:** Approved, ready for implementation
**Mockups:** `resources/hand-completion-options.html` (Options 01, 06, 09)
**Affected files:** iOS views, AppStore

---

## Overview

Three new UI surfaces triggered when hands complete:

1. **Showdown Result Page** — full-screen overlay shown inline immediately after a hand reaches showdown. Based on Option 01 (Center Stage). Tap "Next Hand" to continue.
2. **Split Pot Result Page** — variant of the above for chopped pots. Based on Option 06. Same flow.
3. **Turn Summary Page** — shown after the final action of the turn, before "Turn sent". Based on Option 09. Summarizes all completed hands, auto-acted hands, and net result.

Folds do NOT get a result page. They show a brief "Folded" tag on the compact card and move to the Resolved section immediately.

---

## 1. Showdown Result Page (Center Stage)

### Trigger

Shown immediately after the player submits an action that causes a hand to reach showdown (river call, river check that closes the street). The server response will include `status: "complete"` and `terminal_reason: "showdown"` for that hand.

Detection: after `submitAction()` returns, compare the hand's status before and after. If it transitioned to `complete` with `terminal_reason == "showdown"`, show the result page before returning to the hand list.

### Layout (full-screen overlay on TurnView)

From top to bottom, all centered:

1. **Eyebrow**: "HAND {N} · SHOWDOWN" in gold, 10px, tracking 1.5, uppercase
2. **Card face-off**: Two groups side-by-side with a "vs" badge between them.
   - **Left (You)**: 
     - "YOU" label (eyebrow, cream-300)
     - Two large card faces (48×68px) — your hole cards
     - Hand rank name below (e.g., "Two Pair, Aces & Kings") in gold if you won, cream-300 if you lost
     - If you won: apply gold glow shadow to the card group (`box-shadow: 0 0 30px rgba(212,179,104,0.25)`)
   - **Center**: circular "vs" badge (32×32, dark bg, cream-300 text)
   - **Right (Opponent)**:
     - Opponent first name label (eyebrow, cream-300)
     - Two large card faces — opponent's hole cards
     - **Card flip animation**: cards start face-down (card back pattern), flip to reveal after 0.3s delay. Use a Y-axis rotation animation lasting 0.5s.
     - Hand rank name below — gold if they won, cream-300 if they lost
     - If opponent won: apply claret glow shadow
3. **Board**: row of 5 small card faces (28×40px), centered, standard gap
4. **Divider**: thin gold gradient rule, 60% width
5. **Result**:
   - If you won: "You win" (14px, cream-300) above the amount
   - If you lost: "You lose" (14px, cream-300) above the amount
   - Amount: Georgia 48px. Gold if positive (`+340`), claret if negative (`-480`)
   - Pop-in animation: scale from 0.7 → 1.1 → 1.0 over 0.5s
6. **Favorite button**: star icon, below the amount. Unfilled by default. Tapping fills it gold and calls the favorite API. Label: "Bookmark this hand" in cream-300, 11px.
7. **CTA**: "Next Hand →" primary gold button at the bottom. Full width with 24px horizontal padding. Tapping dismisses the overlay and returns to the hand list.

### Win vs Loss states

| Element | Win | Loss |
|---------|-----|------|
| Your cards | Gold glow | No glow, 50% opacity |
| Opponent cards | No glow, 50% opacity | Claret glow |
| Your hand rank | Gold text | Cream-300 text |
| Opponent hand rank | Cream-300 text | Gold text |
| Amount | Gold, positive (+340) | Claret, negative (-480) |
| Eyebrow color | Gold | Claret |

### Opponent card flip animation

1. Cards render as card backs (felt-600/felt-700 diagonal stripe pattern with gold-600 border)
2. After 0.3s delay, each card rotates 90° on the Y axis (shrinks to 0 width), swaps to the face, then rotates back to 0°
3. Total animation: 0.5s ease-out per card
4. Second card starts 0.15s after the first

---

## 2. Split Pot Result Page

### Trigger

Same as showdown result page, but when `winner_user_id` is null (the hand was chopped).

### Layout differences from Showdown

- **Eyebrow**: "HAND {N} · SPLIT POT" in cream-300 (not gold, not claret — neutral)
- **Neither side glows** — both card groups have equal visual weight, no opacity reduction
- **Center badge**: "SPLIT" pill instead of "vs" circle. Gold text on gold-tinted background with gold border. Rounded rect, not circle.
- **Board + hand rank**: shown the same as showdown. Below the board, show "Both make {hand name}" in cream-300, 12px.
- **Result section**: two columns side by side instead of one centered amount:
  - Left column: "You" label + amount in cream-100 (e.g., "+100")
  - Right column: opponent name + amount in cream-100 (e.g., "+100")
  - Use Georgia 28px for amounts (smaller than the solo winner 48px — less dramatic)
- **Favorite button**: same as showdown — star + "Bookmark this hand"
- **CTA**: same "Next Hand →" button

---

## 3. Turn Summary Page

### Trigger

Shown after the last pending hand has been acted upon (or auto-acted) and before the "Turn sent" overlay. Replaces the current immediate jump to "Turn sent."

Flow: last action submitted → server responds → **Turn Summary Page** → user taps "Send Turn" → "Turn sent / Waiting on opponent" overlay → back to Home.

### Layout (full-screen overlay on TurnView)

Scrollable content:

1. **Header**: 
   - "TURN COMPLETE" eyebrow in gold
   - "Here's what happened" in Georgia 24px, cream-100

2. **Showdowns section** (only if any hands went to showdown this turn):
   - "SHOWDOWNS" eyebrow in gold
   - For each showdown hand, a compact result row:
     - Left: "H{N}" label + your hole cards (small, 22×32) + "vs" + opponent hole cards (small)
     - Right: amount in Georgia 16px — gold if won, claret if lost
     - Whole row in a dark card with border tinted gold (won) or claret (lost)

3. **Your actions section**:
   - "YOUR ACTIONS" eyebrow
   - One line per hand where you made a deliberate action:
     - "H{N}: {action summary}" in cream-200, 12px
     - e.g., "H3: Called river bet · Won showdown"
     - e.g., "H7: Raised to 40 · Waiting on Sarah"

4. **Auto-acted section** (only if any hands were auto-acted):
   - "AUTO-ACTED (0 CHIPS AVAILABLE)" eyebrow in cream-300
   - Group by action type:
     - "H2, H4, H6, H8, H10: Auto-checked (no bet facing)" 
     - "H1: Auto-folded (facing 20 bet)"
   - Use cream-300 text, 12px

5. **Divider**: thin gold gradient rule

6. **Net result**: centered
   - "Net this turn" in cream-300, 12px
   - Amount in Georgia 36px — gold if positive, claret if negative, cream-100 if zero
   - "Stack: {before} → {after}" in cream-300, 11px

7. **CTA**: "Send Turn →" primary gold button. Tapping sends the turn (fires the "Turn sent" overlay as before).

### Data requirements

The turn summary needs to know:
- Which hands completed during this turn (compare hand statuses before and after the turn)
- Which hands were auto-acted (tracked client-side during `autoActIfNeeded`)
- The action taken on each hand (fold/check/call/raise/all-in)
- Net chip change (match total before turn vs after)

**Implementation approach**: track these in `@State` arrays in TurnView:
- `completedShowdowns: [(HandView, HandView)]` — (before, after) for hands that went to showdown
- `autoActedHands: [(String, String)]` — (handId, action) for auto-acted hands  
- `deliberateActions: [(String, String)]` — (handId, summary) for hands the player manually acted on
- `stackBefore: Int` — captured when TurnView opens

---

## 4. Coin Flip Page (from user feedback #1)

### Trigger

Shown when a new match is created, after the server responds with the match state.

### Layout (full-screen, dismiss to Home)

1. **Eyebrow**: "NEW MATCH" in gold
2. **Title**: "Match vs {opponent name}" in Georgia 26px
3. **Coin flip result**:
   - Large text: "You are" in cream-200, 16px
   - Role: "Small Blind" or "Big Blind" in Georgia 32px, gold
   - Subtitle: "You act first this round" (if SB) or "Sarah acts first this round" (if BB) in cream-300, 13px
4. **Explanation**: "Position flips each round. SB/Button acts first preflop, BB acts first on flop, turn, and river." in cream-300, 12px, max-width 280px, centered
5. **CTA**: "Deal the cards →" primary gold button. Tapping navigates to the Turn View (if it's your turn) or Home (if opponent acts first).

---

## 5. Favorite Button (from user feedback)

### Behavior

- Shown on the Showdown Result Page and Split Pot Result Page
- Star icon (SF Symbol `star` / `star.fill`) + "Bookmark this hand" text
- Unfilled (outline) by default
- Tapping fills the star gold and calls `POST /v1/hand/{handId}/favorite` with `{ favorite: true }`
- Tapping again unfills and calls with `{ favorite: false }`
- Optimistic UI: star fills/unfills immediately, server call fires in background
- The favorite state persists — when viewing the hand later in History, it appears in the Favorites filter

### Placement

- Showdown/Split result page: between the result amount and the CTA button
- 8px above the CTA, centered
- Star icon: 20px, gold-500 when filled, cream-300 outline when empty
- "Bookmark this hand" label: 11px, cream-300

---

## Files to modify

### New files
- `apps/ios/Tilted/Tilted/Views/Turn/ShowdownResultView.swift` — the Center Stage showdown overlay + split pot variant
- `apps/ios/Tilted/Tilted/Views/Turn/TurnSummaryView.swift` — the end-of-turn summary
- `apps/ios/Tilted/Tilted/Views/Home/CoinFlipView.swift` — new match coin flip page

### Modified files
- `apps/ios/Tilted/Tilted/Views/Turn/TurnView.swift` — integrate showdown result overlay, turn summary, auto-act tracking
- `apps/ios/Tilted/Tilted/Views/Home/HomeView.swift` — show CoinFlipView when match is newly created
- `apps/ios/Tilted/Tilted/Store/AppStore.swift` — track turn state for summary (stack before, auto-acted hands)
- `apps/ios/Tilted/Tilted/Components/PlayingCardView.swift` — add card back view variant and flip animation modifier

### No server changes needed
All data is already available in the existing API responses. The `HandView` includes `status`, `terminal_reason`, `winner_user_id`, `my_hole`, `opponent_hole`, `board`, `pot`, and `action_summary`. The favorite endpoint already exists.

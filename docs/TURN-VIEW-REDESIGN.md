# Turn View Redesign — Implementation Spec

**Status:** Approved mockup, ready for implementation
**Mockup:** `resources/turn-view-final.html` (interactive prototype)
**Affected files:** `apps/ios/Tilted/Tilted/Views/Turn/TurnView.swift`

---

## Overview

Replace the current inline-action hand card list with a two-level UI:

1. **List view** — compact, tappable hand cards grouped by status. No action buttons on cards. Tapping a pending hand opens the detail view.
2. **Detail view** — a bottom sheet with full action history, large cards, a "facing" banner, and action buttons. All actions are taken from here.

## List View

### Layout

- **Sticky header bar**: back chevron (left), "{N} of 10 hands left" (center), "Avail: {available}" (right, gold text)
- Below the header: a scrollable list of hands grouped into three sections

### Sections (grouped by status)

Each section has a header row: a small colored dot, section title in eyebrow caps, and a count on the right.

#### 1. "Action Required" (gold dot)

- Shown only if there are hands where `action_on_me == true` and `status == "in_progress"`
- Each hand renders as a **compact card** (described below)
- Cards have a gold border (`rgba(212,179,104,0.5)`) and subtle gold background tint
- Tapping a card opens the **detail view** for that hand

##### Compact card layout

A single row containing:
- **Hole cards** (small card faces, 22×32px)
- **Info block** (flex: 1):
  - Top line: "Hand {N} · {Street}" where street is gold-colored. Right-aligned: "Facing {amount}" in gold (if bet facing) or "Check to you" in cream-300 (if no bet)
  - Bottom line (subtitle): one-line action summary in cream-300, e.g. "You raised 30, SF called · SF bet 40". Truncate with ellipsis if too long.
- **Chevron** "›" in cream-300 on the far right

The subtitle should be generated from the hand's action history. Format: "{actor} {action} {amount}" joined by " · " with street transitions separated by " · ". Examples:
- "You raised 30, SF called · SF bet 40"
- "SF limped · No bet facing you · Pot 20"
- "3-bet pot · SF barrels turn · Pot 340"

#### 2. "Waiting on {opponent}" (cream-300 dot)

- Shown only if there are hands where `action_on_me == false` and `status == "in_progress"`
- Rendered as a horizontal wrapping row of **chip pills** (not full cards)
- Each pill: "H{N} · {Street} · Pot {pot}" in cream-200 on dark background, 11px font, rounded

#### 3. "Resolved" (cream-400 dot)

- Shown for hands where `status` is `complete` or `awaiting_runout`
- Rendered as a horizontal wrapping row of **chip pills** with status tags:
  - Folded: gray "F" tag, "H{N} · Folded"
  - Won: gold "W" tag, "H{N} · Won {pot}"
  - Lost: claret tag, "H{N} · Lost {pot}"
  - All-in: claret "AI" tag, "H{N} · All-In · Pot {pot}"

### Auto-check behavior (unchanged)

When `myAvailable == 0` and all remaining pending hands have no bet facing them (only legal action is check), auto-submit checks for all of them without requiring the user to tap through each one.

## Detail View

Presented as a **bottom sheet** covering ~90% of the screen, with a dim overlay behind it. Slide-up animation on open.

### Structure (top to bottom)

1. **Handle bar** — 36px wide, 4px tall, centered. Tapping or dragging down closes the sheet.

2. **Header row** — "Hand {N}" in Georgia 20px (left), "✕" close button in a small circle (right). Bottom border.

3. **Street tag** — e.g. "FLOP" in a gold pill/tag, left-aligned.

4. **Cards row** — two groups side by side:
   - "YOUR CARDS" label (eyebrow) above two large card faces (36×52px)
   - "BOARD" label (eyebrow) above the community cards (same size) plus placeholder cards for undealt streets

5. **Action log** — dark background rounded box containing the full action history:
   - Street separators: "PREFLOP", "FLOP · Q♦ 7♣ 2♥", etc. in gold, 9px uppercase
   - Action entries: "{Actor}" (bold, cream-100) + "{action}" (cream-300) + "{amount}" (gold). One line per action. 12px font.
   - Show ALL actions for the hand, from the first preflop action through to the current pending action.

6. **Facing banner** — a bordered box showing what decision the player faces:
   - **If facing a bet**: arrow icon (→) in a circle, "Facing a bet of" text, large amount in Georgia gold, and "After call / {available} avail" on the right
   - **If no bet facing (check opportunity)**: checkmark icon (✓), "No bet facing you" text, "You can check or bet" subtitle, available chips on the right

7. **Pot line** — "Pot: {amount}" on the left, "Your committed: {amount}" on the right. 12px, cream-300.

8. **Action buttons row** — full-width row of buttons. Each button is flex:1, 12px padding, 13px bold text, 10px border-radius.
   - **When facing a bet**: Fold (claret border), Call {amount} (gold border, primary), Raise (neutral border), All-In (subtle claret border)
   - **When no bet facing**: Check (gold border, primary), Bet (neutral border), All-In (subtle border)
   - Tapping an action button:
     1. Submits the action to the server (same `store.submitAction` call as today)
     2. Closes the detail sheet
     3. The list re-renders with the hand moved to the appropriate section
   - Raise and Bet buttons should open the existing `BetSheet` (the slider/quick-button modal)

### Close behavior

- Tapping the dim overlay, the handle, or the ✕ button closes the sheet **without taking any action**
- The player can review hand details and go back to the list to look at other hands before deciding

## Data requirements

### Action history for the detail view

The current `HandView` model does NOT include action history. The detail view needs to fetch it. Options:

**Option A (recommended):** When opening the detail view, call `GET /v1/hand/{handId}` to fetch the full `HandDetail` including `actions[]`. Cache it for the duration of the detail sheet.

**Option B:** Include a summary of actions in the `HandView` returned by `/v1/match/current`. This adds payload size but avoids an extra request.

Go with Option A. The `APIClient.getHandDetail(handId:)` method already exists.

### Action summary for compact cards

The one-line subtitle on compact cards needs a short action summary. This should be generated client-side from the action history, or returned by the server as a precomputed field.

**Recommended approach:** Add a field `action_summary: string` to the `HandView` response from `/v1/match/current`. Compute it server-side using the existing `generateActionSketch()` function in `src/game/action-sketch.ts`. This avoids fetching full action history just to render the list.

### Server changes needed

1. **Add `action_summary` to HandView response** in `src/game/match.ts`:
   - In `buildHandView()`, query the hand's actions and call `generateActionSketch()` to produce the one-line summary
   - Add the field to the `HandView` type and the iOS `HandView` Codable model

2. **No other server changes** — all endpoints already exist.

### iOS model changes

Add to `HandView` in `APIModels.swift`:
```swift
let actionSummary: String

enum CodingKeys: String, CodingKey {
    // ... existing keys ...
    case actionSummary = "action_summary"
}
```

## Design tokens (from mockup)

All colors use the existing Classic Premium palette. No new tokens.

- Compact card pending border: `rgba(212,179,104,0.5)` → `Color.gold500.opacity(0.5)`
- Compact card pending bg: `rgba(212,179,104,0.04)` → `Color.gold500.opacity(0.04)`
- Section dot colors: gold-500 (action required), cream-300 (waiting), cream-400 (resolved)
- Action log background: `Color.black.opacity(0.2)`, corner radius 10
- Facing banner: `Color.gold500.opacity(0.06)` bg, `Color.gold500.opacity(0.25)` border
- Action button styles:
  - Fold: claret border, claret text
  - Call/Check (primary): gold border, gold bg tint, gold text
  - Raise/Bet: neutral border, cream text
  - All-In: subtle claret border, cream text

## SwiftUI implementation notes

- The detail view should be presented as a `.sheet` with `.presentationDetents([.large])` or a custom `fullScreenCover` with the dim + panel pattern from the mockup
- Use `@State private var selectedHand: HandView?` to drive the sheet presentation
- The `BetSheet` already exists and should be reused when Raise/Bet is tapped from the detail view
- The all-in confirmation alert already exists and should be reused
- The auto-check logic already exists and should be preserved
- `HandCardView` (the old inline card with action buttons) is replaced entirely by the new compact card + detail view pattern

## Files to modify

1. `apps/ios/Tilted/Tilted/Views/Turn/TurnView.swift` — full rewrite of the view structure
2. `apps/ios/Tilted/Tilted/Networking/Models/APIModels.swift` — add `actionSummary` to `HandView`
3. `apps/server/src/game/match.ts` — add `action_summary` to `buildHandView()`
4. `apps/server/src/game/match.ts` — add `action_summary` to `HandView` TypeScript type

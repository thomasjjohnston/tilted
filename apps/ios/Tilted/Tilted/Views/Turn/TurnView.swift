import SwiftUI

// MARK: - Turn View — hybrid focused table + 10-hand strip

struct TurnView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let match: MatchState
    let round: RoundView

    // Focused hand (the one rendered on the felt). Defaults to the
    // lowest-index pending hand; user can tap a puck to focus another.
    @State private var focusedHandId: String?
    @State private var betSheetHand: HandView?
    @State private var allInConfirmHand: HandView?
    @State private var showTurnComplete = false
    @State private var isAutoChecking = false

    // Completion overlays — one per outcome type.
    @State private var handWonView: HandView?      // Opponent folded → you win
    @State private var handFoldedView: HandView?   // You folded → you lose
    @State private var showdownResult: HandView?   // Showdown / split / lose-at-showdown

    // Wave-crossing overlay state — populated by advanceAfterResolution
    // when the next pending hand is on a later street.
    @State private var waveCrossingFromStreet: String?
    @State private var waveCrossingToStreet: String?

    // Turn summary tracking
    @State private var showTurnSummary = false
    @State private var stackBefore: Int = 0
    @State private var deliberateActions: [(handIndex: Int, summary: String)] = []
    @State private var autoActedHands: [(handIndex: Int, action: String)] = []
    @State private var autoActedHandSnapshots: [HandView] = []
    @State private var showdownsThisTurn: [HandView] = []
    @State private var resolvedThisTurn: [HandView] = []
    @State private var handStatusesBefore: [String: String] = [:]

    // MARK: - Live data

    private var liveHands: [HandView] {
        store.matchState?.currentRound?.hands ?? round.hands
    }

    private var pendingHands: [HandView] {
        liveHands.filter { $0.isPendingAction }
    }

    private var focusedHand: HandView? {
        if let id = focusedHandId,
           let found = liveHands.first(where: { $0.handId == id }) {
            return found
        }
        return pendingHands.first ?? liveHands.first
    }

    private var liveMatch: MatchState { store.matchState ?? match }
    private var liveRound: RoundView { liveMatch.currentRound ?? round }

    private var myRole: String { liveRound.myRole }
    private var smallBlind: Int { 5 }   // Mirrors server constants
    private var bigBlind: Int { 10 }

    // MARK: - Body

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            VStack(spacing: 0) {
                header

                if let hand = focusedHand {
                    ScrollView {
                        VStack(spacing: 14) {
                            FeltTableView(
                                hand: hand,
                                match: liveMatch,
                                myRole: myRole,
                                smallBlind: smallBlind,
                                bigBlind: bigBlind
                            )
                            .padding(.horizontal, 14)
                            .padding(.top, 10)

                            PositionBanner(
                                myRole: myRole,
                                actingOrderHint: positionHint(for: hand),
                                danger: hand.facingBet && hand.callCost >= liveMatch.myAvailable
                            )
                            .padding(.horizontal, 14)

                            actionBar(for: hand)
                                .padding(.horizontal, 14)

                            // Show a tap-for-history affordance
                            Button {
                                // Tap focused hand → open detail sheet for full history
                                // (reuse existing HandActionDetailSheet via the
                                // dedicated state below).
                                detailSheetHand = hand
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "list.bullet.rectangle")
                                        .font(.system(size: 10))
                                    Text("Action history")
                                        .font(.system(size: 11))
                                }
                                .foregroundColor(.cream300)
                                .padding(.top, 2)
                            }
                            .padding(.bottom, 6)
                        }
                    }
                    .scrollIndicators(.hidden)
                } else {
                    // Round complete or no current round → empty state
                    Spacer()
                    Text("No hand to focus")
                        .font(.system(size: 13))
                        .foregroundColor(.cream300)
                    Spacer()
                }

                HandStrip(
                    hands: liveHands,
                    currentUserId: store.currentUserId,
                    focusedHandId: focusedHand?.handId,
                    onSelect: { hand in
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) {
                            focusedHandId = hand.handId
                        }
                    }
                )
            }

            if isAutoChecking {
                autoActOverlay
            }

            if let hand = handWonView {
                HandWonView(
                    hand: hand,
                    match: liveMatch,
                    onContinue: { handWonView = nil; advanceAfterResolution() }
                )
                .transition(.opacity)
                .zIndex(2)
            }

            if let hand = handFoldedView {
                HandFoldedView(
                    hand: hand,
                    match: liveMatch,
                    onContinue: { handFoldedView = nil; advanceAfterResolution() }
                )
                .transition(.opacity)
                .zIndex(2)
            }

            if let hand = showdownResult {
                let pendingOthers = pendingHands.filter { $0.handId != hand.handId }
                ShowdownResultView(
                    hand: hand,
                    match: liveMatch,
                    remainingPendingCount: pendingOthers.count,
                    hasNextPending: !pendingOthers.isEmpty,
                    onFavorite: { fav in
                        Task { await store.toggleFavorite(handId: hand.handId, favorite: fav) }
                    },
                    onBackToList: {
                        showdownResult = nil
                        checkTurnComplete()
                    },
                    onNextHand: {
                        showdownResult = nil
                        if let next = pendingOthers.first {
                            focusedHandId = next.handId
                        } else {
                            checkTurnComplete()
                        }
                    }
                )
                .transition(.opacity)
                .zIndex(2)
            }

            if showTurnSummary {
                TurnSummaryView(
                    match: liveMatch,
                    round: liveRound,
                    resolvedHands: resolvedThisTurn,
                    autoActedHands: autoActedHands,
                    autoActedHandViews: autoActedHandSnapshots,
                    stackBefore: stackBefore,
                    currentUserId: store.currentUserId,
                    onSendTurn: {
                        showTurnSummary = false
                        withAnimation { showTurnComplete = true }
                    }
                )
                .transition(.opacity)
                .zIndex(3)
            }

            if showTurnComplete { turnCompleteOverlay }

            if let from = waveCrossingFromStreet, let to = waveCrossingToStreet {
                WaveCompleteView(fromStreet: from, toStreet: to)
                    .transition(.opacity)
                    .zIndex(4)
            }
        }
        .sheet(item: $detailSheetHand) { hand in
            HandActionDetailSheet(
                hand: hand,
                match: liveMatch,
                round: liveRound,
                onAction: { type, amount in
                    detailSheetHand = nil
                    handleAction(hand: hand, type: type, amount: amount)
                },
                onDismiss: { detailSheetHand = nil }
            )
            .environment(store)
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $betSheetHand) { hand in
            BetSheet(
                hand: hand,
                match: liveMatch,
                onSubmit: { amount, type in
                    betSheetHand = nil
                    Task { await submitAction(hand: hand, type: type, amount: amount) }
                }
            )
            .presentationDetents([.medium])
        }
        .alert("All In?", isPresented: Binding(
            get: { allInConfirmHand != nil },
            set: { if !$0 { allInConfirmHand = nil } }
        )) {
            Button("Confirm All-In", role: .destructive) {
                if let hand = allInConfirmHand {
                    allInConfirmHand = nil
                    Task { await submitAction(hand: hand, type: "all_in") }
                }
            }
            Button("Cancel", role: .cancel) { allInConfirmHand = nil }
        } message: {
            Text("This action cannot be undone.")
        }
        .onChange(of: pendingHands.count) { _, newCount in
            if newCount == 0 && !showTurnComplete && !showTurnSummary
                && showdownResult == nil && handWonView == nil {
                checkTurnComplete()
            }
        }
        .onChange(of: focusedHand?.handId) { _, _ in
            checkForUnseenFoldResolution()
        }
        .task {
            stackBefore = match.myAvailable
            for hand in round.hands {
                handStatusesBefore[hand.handId] = hand.status
            }
            if focusedHandId == nil {
                focusedHandId = pendingHands.first?.handId ?? round.hands.first?.handId
            }
            checkForUnseenFoldResolution()
            await autoActIfNeeded()
        }
        .onChange(of: store.matchState?.currentRound?.hands.map(\.status)) { _, _ in
            Task { await autoActIfNeeded() }
        }
    }

    // MARK: - Detail sheet state (separate from focused hand)

    @State private var detailSheetHand: HandView?

    // MARK: - Header

    private var header: some View {
        MatchHeaderBar(
            myAvailable: liveMatch.myAvailable,
            opponentName: liveMatch.opponent.displayName.components(separatedBy: " ").first ?? "Opp",
            opponentAvailable: liveMatch.opponentAvailable,
            onBack: { dismiss() },
            trailing: AnyView(
                HStack(spacing: 8) {
                    HStack(spacing: 3) {
                        ForEach(liveHands) { hand in
                            Circle()
                                .fill(dotColor(for: hand))
                                .frame(width: 6, height: 6)
                                .shadow(
                                    color: hand.handId == focusedHand?.handId ? Color.gold500 : .clear,
                                    radius: 4
                                )
                        }
                    }
                    Text("\(pendingHands.count)/10")
                        .font(.system(size: 10))
                        .foregroundColor(.cream300)
                }
            )
        )
    }

    private func dotColor(for hand: HandView) -> Color {
        if hand.status == "complete" {
            return hand.winnerUserId == store.currentUserId
                ? Color(hex: 0x4ea878) : Color.cream400.opacity(0.4)
        }
        if hand.actionOnMe { return .gold500 }
        return Color.cream300.opacity(0.25)
    }

    // MARK: - Action bar

    @ViewBuilder
    private func actionBar(for hand: HandView) -> some View {
        if hand.isPendingAction {
            VStack(spacing: 8) {
                HStack {
                    if hand.facingBet {
                        Text("Facing \(hand.callCost) to call")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.gold500)
                    } else {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 11))
                            Text("Check available")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundColor(.gold500)
                    }
                    Spacer()
                    if hand.facingBet, liveMatch.myAvailable >= hand.callCost {
                        Text("After call: \(liveMatch.myAvailable - hand.callCost)")
                            .font(.system(size: 10))
                            .foregroundColor(.cream300)
                    } else {
                        Text("Stack: \(liveMatch.myAvailable)")
                            .font(.system(size: 10))
                            .foregroundColor(.cream300)
                    }
                }
                HStack(spacing: 6) {
                    if hand.facingBet {
                        actionBtn("Fold", style: .fold) { handleAction(hand: hand, type: "fold", amount: nil) }
                        if liveMatch.myAvailable >= hand.callCost {
                            actionBtn("Call \(hand.callCost)", style: .call) {
                                handleAction(hand: hand, type: "call", amount: nil)
                            }
                            if liveMatch.myAvailable > hand.callCost {
                                actionBtn("Raise", style: .primary) {
                                    handleAction(hand: hand, type: "raise", amount: nil)
                                }
                            }
                        }
                        if liveMatch.myAvailable > 0 {
                            actionBtn("All-In", style: .allIn) { handleAction(hand: hand, type: "all_in", amount: nil) }
                        }
                    } else {
                        actionBtn("Check", style: .call) { handleAction(hand: hand, type: "check", amount: nil) }
                        if liveMatch.myAvailable > 0 {
                            actionBtn("Bet", style: .primary) { handleAction(hand: hand, type: "bet", amount: nil) }
                            actionBtn("All-In", style: .allIn) { handleAction(hand: hand, type: "all_in", amount: nil) }
                        }
                    }
                }
            }
            .padding(12)
            .background(Color.black.opacity(0.3))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(Color.gold500.opacity(0.22), lineWidth: 1)
            )
            .cornerRadius(14)
        } else {
            // Resolved or waiting — no actions; show a brief status line.
            HStack {
                statusBanner(for: hand)
                Spacer()
            }
            .padding(.vertical, 4)
        }
    }

    @ViewBuilder
    private func statusBanner(for hand: HandView) -> some View {
        if hand.status == "in_progress" && !hand.actionOnMe {
            HStack(spacing: 8) {
                Circle().fill(Color.cream300).frame(width: 6, height: 6)
                    .shadow(color: .cream300, radius: 4)
                Text("Waiting on \(match.opponent.displayName.components(separatedBy: " ").first ?? "opponent")")
                    .font(.system(size: 12))
                    .foregroundColor(.cream200)
            }
        } else if hand.status == "complete" {
            HStack(spacing: 6) {
                let won = hand.winnerUserId == store.currentUserId
                Text(won ? "Won" : (hand.winnerUserId == nil ? "Split" : "Lost"))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(won ? Color(hex: 0x4ea878) : .cream300)
                if let net = hand.myResolvedNet {
                    Text(net >= 0 ? "+\(net)" : "\(net)")
                        .font(.custom("Georgia", size: 13).bold())
                        .foregroundColor(net >= 0 ? Color(hex: 0x4ea878) : .claret)
                }
            }
        }
    }

    private enum ActionStyle { case fold, call, primary, allIn }

    private func actionBtn(_ title: String, style: ActionStyle, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .foregroundColor(fg(style))
                .background(bg(style))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(border(style), lineWidth: 1)
                )
                .cornerRadius(10)
        }
    }

    private func fg(_ s: ActionStyle) -> Color {
        switch s {
        case .fold: return .claret
        case .call: return .cream100
        case .primary: return .felt800
        case .allIn: return .cream100
        }
    }
    private func bg(_ s: ActionStyle) -> AnyView {
        switch s {
        case .fold: return AnyView(Color.claret.opacity(0.12))
        case .call: return AnyView(Color.gold500.opacity(0.18))
        case .primary: return AnyView(
            LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom)
        )
        case .allIn: return AnyView(Color.claret.opacity(0.18))
        }
    }
    private func border(_ s: ActionStyle) -> Color {
        switch s {
        case .fold: return Color.claret.opacity(0.4)
        case .call: return Color.gold500.opacity(0.4)
        case .primary: return Color.gold500.opacity(0.7)
        case .allIn: return Color.claret.opacity(0.45)
        }
    }

    // MARK: - Auto-act overlay

    private var autoActOverlay: some View {
        ZStack {
            Color.felt900.opacity(0.85).ignoresSafeArea()
            VStack(spacing: 12) {
                ProgressView().tint(.gold500).scaleEffect(1.2)
                Text("Auto-folding unplayable hands…")
                    .font(.system(size: 13))
                    .foregroundColor(.cream200)
                Text("0 chips available")
                    .font(.system(size: 11))
                    .foregroundColor(.cream300)
            }
        }
        .transition(.opacity)
    }

    // MARK: - Turn complete overlay

    private var turnCompleteOverlay: some View {
        ZStack {
            Color.felt900.opacity(0.9).ignoresSafeArea()
            VStack(spacing: Spacing.lg) {
                Text("✅").font(.system(size: 64))
                Text("Turn sent.")
                    .font(.displayMedium).fontDesign(.serif).foregroundColor(.cream100)
                Text("Waiting on \(match.opponent.displayName.components(separatedBy: " ").first ?? "opponent").")
                    .font(.bodySecondary).foregroundColor(.cream300)
                Button("Back to Home") { dismiss() }
                    .buttonStyle(.primary)
                    .padding(.horizontal, 40)
            }
        }
    }

    // MARK: - Helpers

    private func positionHint(for hand: HandView) -> String? {
        if hand.street == "preflop" {
            return myRole == "sb" ? "you act first preflop" : "you act second preflop"
        }
        return myRole == "bb" ? "you act first postflop" : "you act second postflop"
    }

    // MARK: - Fold resolution surfacing

    private func checkForUnseenFoldResolution() {
        guard let hand = focusedHand else { return }
        guard hand.status == "complete",
              hand.terminalReason == "fold",
              hand.winnerUserId == store.currentUserId else { return }
        // Only show once per hand per session
        guard !store.seenFoldResolutions.contains(hand.handId) else { return }
        store.seenFoldResolutions.insert(hand.handId)
        withAnimation { handWonView = hand }
    }

    // MARK: - Action dispatch

    private func handleAction(hand: HandView, type: String, amount: Int?) {
        if type == "raise" || type == "bet" {
            betSheetHand = hand
        } else if type == "all_in" {
            allInConfirmHand = hand
        } else {
            Task { await submitAction(hand: hand, type: type, amount: amount) }
        }
    }

    private func submitAction(hand: HandView, type: String, amount: Int? = nil) async {
        await store.submitAction(handId: hand.handId, type: type, amount: amount)

        let actionLabel: String
        switch type {
        case "fold": actionLabel = "Folded"
        case "check": actionLabel = "Checked"
        case "call": actionLabel = "Called"
        case "bet": actionLabel = "Bet \(amount ?? 0)"
        case "raise": actionLabel = "Raised to \(amount ?? 0)"
        case "all_in": actionLabel = "All-in"
        default: actionLabel = type
        }
        deliberateActions.append((handIndex: hand.handIndex, summary: actionLabel))

        if let updatedRound = store.matchState?.currentRound,
           let updatedHand = updatedRound.hands.first(where: { $0.handId == hand.handId }),
           updatedHand.status == "complete" {
            resolvedThisTurn.append(updatedHand)
            // Every completion type gets a dismissable surface, per the
            // "Completed Hand requires clearing" UX rule. Pre-mark as
            // seen so the retroactive queue doesn't re-fire later.
            store.markCompletionSeen(updatedHand.handId)
            if updatedHand.terminalReason == "showdown" {
                showdownsThisTurn.append(updatedHand)
                withAnimation { showdownResult = updatedHand }
                return
            }
            if updatedHand.terminalReason == "fold" && type == "fold" {
                // The user folded — show the HandFoldedView mirror.
                withAnimation { handFoldedView = updatedHand }
                return
            }
        }

        advanceAfterResolution()
        await autoActIfNeeded()
    }

    private func advanceAfterResolution() {
        guard let current = focusedHand else { checkTurnComplete(); return }
        let result = HandPicker.nextHand(after: current, in: liveHands)
        if let crossed = result.crossedToStreet, let next = result.next {
            // Show the WaveCompleteView for ~1.5s then move focus to
            // the first hand of the next street.
            waveCrossingFromStreet = current.street
            waveCrossingToStreet = crossed
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) {
                    focusedHandId = next.handId
                    waveCrossingFromStreet = nil
                    waveCrossingToStreet = nil
                }
            }
        } else if let next = result.next {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) {
                focusedHandId = next.handId
            }
        }
        checkTurnComplete()
    }

    private func checkTurnComplete() {
        let currentPending = store.matchState?.currentRound?.hands.filter { $0.isPendingAction } ?? []
        if currentPending.isEmpty && !showTurnSummary && !showTurnComplete {
            if !resolvedThisTurn.isEmpty || !autoActedHands.isEmpty || deliberateActions.count > 1 {
                withAnimation { showTurnSummary = true }
            } else {
                withAnimation { showTurnComplete = true }
            }
        }
    }

    private func autoActIfNeeded() async {
        guard !isAutoChecking else { return }
        guard let currentRound = store.matchState?.currentRound else { return }
        let available = store.matchState?.myAvailable ?? 0
        guard available == 0 else { return }

        let pending = currentRound.hands.filter { $0.isPendingAction }
        guard !pending.isEmpty else { return }

        isAutoChecking = true
        let actionsToTake = pending.map { hand in
            (hand: hand, action: hand.facingBet ? "fold" : "check")
        }
        autoActedHandSnapshots = actionsToTake.map { $0.hand }
        for (hand, action) in actionsToTake {
            autoActedHands.append((handIndex: hand.handIndex, action: action))
        }
        await store.submitBatchActions(
            actions: actionsToTake.map { ($0.hand.handId, $0.action, nil as Int?) }
        )
        isAutoChecking = false
        checkTurnComplete()
    }
}

// MARK: - Street ordering helpers

/// Heads-up street-first ordering: preflop hands act first, then flop,
/// then turn, then river. The picker keeps the user inside one "wave"
/// before crossing to the next street.
extension HandView {
    var streetOrder: Int {
        switch street {
        case "preflop": return 0
        case "flop": return 1
        case "turn": return 2
        case "river": return 3
        default: return 4
        }
    }
}

enum HandPicker {
    /// Returns the next pending hand to focus, plus the street being
    /// crossed into (if the wave changes). Sorts by (streetOrder,
    /// handIndex).
    static func nextHand(after current: HandView, in hands: [HandView]) -> (next: HandView?, crossedToStreet: String?) {
        let pending = hands.filter { $0.isPendingAction }
        let sorted = pending.sorted {
            ($0.streetOrder, $0.handIndex) < ($1.streetOrder, $1.handIndex)
        }
        guard let next = sorted.first(where: { $0.handId != current.handId }) else {
            return (nil, nil)
        }
        let crossed = next.streetOrder > current.streetOrder ? next.street : nil
        return (next, crossed)
    }
}

// MARK: - Hand Action Detail Sheet (preserved for action history)

struct HandActionDetailSheet: View {
    let hand: HandView
    let match: MatchState
    let round: RoundView
    let onAction: (String, Int?) -> Void
    let onDismiss: () -> Void

    @Environment(AppStore.self) private var store
    @State private var handDetail: HandDetail?
    @State private var isLoading = true

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text("Hand \(hand.handIndex + 1)")
                            .font(.custom("Georgia", size: 22))
                            .foregroundColor(.cream100)
                        Spacer()
                        Button { onDismiss() } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.cream200)
                                .frame(width: 28, height: 28)
                                .background(Color.cream100.opacity(0.08))
                                .clipShape(Circle())
                                .overlay(Circle().stroke(Color.gold500.opacity(0.2), lineWidth: 1))
                        }
                    }
                    .padding(.top, 8)

                    Text(hand.street.uppercased())
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(0.5)
                        .foregroundColor(.gold500)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.gold500.opacity(0.12))
                        .cornerRadius(4)
                        .padding(.top, 12)

                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("YOUR CARDS")
                                .font(.system(size: 9, weight: .medium))
                                .tracking(1)
                                .foregroundColor(.cream300)
                            HStack(spacing: 3) {
                                ForEach(hand.myHole, id: \.self) { card in
                                    PlayingCardView(card: card, size: .large)
                                }
                            }
                        }

                        if !hand.board.isEmpty || hand.street != "preflop" {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("BOARD")
                                    .font(.system(size: 9, weight: .medium))
                                    .tracking(1)
                                    .foregroundColor(.cream300)
                                HStack(spacing: 3) {
                                    ForEach(hand.board, id: \.self) { card in
                                        PlayingCardView(card: card, size: .large)
                                    }
                                    ForEach(0..<max(0, 5 - hand.board.count), id: \.self) { _ in
                                        CardPlaceholderView(size: .large)
                                    }
                                }
                            }
                        }
                    }
                    .padding(.top, 14)

                    if let detail = handDetail {
                        actionLogView(detail: detail)
                    } else if isLoading {
                        ProgressView()
                            .tint(.gold500)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 16)
                    }
                }
                .padding(.horizontal, 18)
            }
        }
        .task {
            do {
                handDetail = try await APIClient.shared.getHandDetail(handId: hand.handId)
            } catch {
                // Fall back silently
            }
            isLoading = false
        }
    }

    private func actionLogView(detail: HandDetail) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            var lastStreet = ""
            ForEach(detail.actions) { action in
                let needsSep = action.street != lastStreet
                VStack(alignment: .leading, spacing: 0) {
                    if needsSep {
                        Text(streetLabel(action.street, board: detail.board))
                            .font(.system(size: 9, weight: .medium))
                            .tracking(1)
                            .foregroundColor(.gold500)
                            .padding(.top, needsSep ? 6 : 0)
                            .padding(.bottom, 2)
                            .onAppear { lastStreet = action.street }
                    }
                    HStack(spacing: 6) {
                        Text(action.actingUserId == store.currentUserId ? "You" : opponentFirstName)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.cream100)
                            .frame(minWidth: 36, alignment: .leading)
                        Text(action.actionType.replacingOccurrences(of: "_", with: " "))
                            .font(.system(size: 12))
                            .foregroundColor(.cream300)
                        if action.amount > 0 {
                            Text("\(action.amount)")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.gold500)
                        }
                        Spacer()
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .padding(10)
        .background(Color.black.opacity(0.2))
        .cornerRadius(10)
        .padding(.top, 12)
    }

    private func streetLabel(_ street: String, board: [String]) -> String {
        switch street {
        case "preflop": return "PREFLOP"
        case "flop":
            let cards = board.prefix(3).joined(separator: " ")
            return "FLOP · \(cards)"
        case "turn":
            let card = board.count >= 4 ? board[3] : ""
            return "TURN · \(card)"
        case "river":
            let card = board.count >= 5 ? board[4] : ""
            return "RIVER · \(card)"
        default: return street.uppercased()
        }
    }

    private var opponentFirstName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opp"
    }
}

// MARK: - Flow Layout (wrapping horizontal pills — still used by other views)

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(proposal: proposal, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxX: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            maxX = max(maxX, x)
        }

        return (CGSize(width: maxX, height: y + rowHeight), positions)
    }
}

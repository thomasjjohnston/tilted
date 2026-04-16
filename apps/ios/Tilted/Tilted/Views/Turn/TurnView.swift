import SwiftUI

// MARK: - Turn View (grouped list + detail sheet)

struct TurnView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let match: MatchState
    let round: RoundView

    @State private var selectedHand: HandView?
    @State private var betSheetHand: HandView?
    @State private var allInConfirmHand: HandView?
    @State private var showTurnComplete = false
    @State private var isAutoChecking = false

    // MARK: - Computed groups

    private var pendingHands: [HandView] {
        round.hands.filter { $0.isPendingAction }
    }

    private var waitingHands: [HandView] {
        round.hands.filter { $0.status == "in_progress" && !$0.actionOnMe }
    }

    private var resolvedHands: [HandView] {
        round.hands.filter { $0.status == "complete" || $0.status == "awaiting_runout" }
    }

    // MARK: - Body

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            VStack(spacing: 0) {
                // Sticky header
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .foregroundColor(.cream200)
                            .font(.system(size: 20))
                    }
                    Spacer()
                    Text("\(pendingHands.count) of 10 hands left")
                        .font(.system(size: 13))
                        .foregroundColor(.cream100)
                    Spacer()
                    Text("Avail: \(match.myAvailable)")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.gold500)
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(Color.felt800.opacity(0.95))

                // Grouped hand list
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        // Action Required
                        if !pendingHands.isEmpty {
                            sectionHeader(
                                dot: .gold500,
                                title: "Action Required",
                                count: pendingHands.count
                            )
                            ForEach(pendingHands) { hand in
                                CompactHandCard(hand: hand, myAvailable: match.myAvailable)
                                    .onTapGesture { selectedHand = hand }
                            }
                        }

                        // Waiting on opponent
                        if !waitingHands.isEmpty {
                            sectionHeader(
                                dot: .cream300,
                                title: "Waiting on \(match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent")",
                                count: waitingHands.count
                            )
                            chipPillRow(hands: waitingHands) { hand in
                                "H\(hand.handIndex + 1) \u{00B7} \(hand.street.capitalized) \u{00B7} Pot \(hand.pot)"
                            }
                        }

                        // Resolved
                        if !resolvedHands.isEmpty {
                            sectionHeader(
                                dot: .cream400,
                                title: "Resolved",
                                count: resolvedHands.count
                            )
                            chipPillRow(hands: resolvedHands) { hand in
                                resolvedPillText(hand)
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 40)
                }
            }

            // Turn complete overlay
            if showTurnComplete {
                turnCompleteOverlay
            }
        }
        // Detail sheet
        .sheet(item: $selectedHand) { hand in
            HandActionDetailSheet(
                hand: hand,
                match: match,
                round: round,
                onAction: { type, amount in
                    selectedHand = nil
                    if type == "raise" || type == "bet" {
                        betSheetHand = hand
                    } else if type == "all_in" {
                        allInConfirmHand = hand
                    } else {
                        Task { await submitAction(hand: hand, type: type, amount: amount) }
                    }
                },
                onDismiss: { selectedHand = nil }
            )
            .environment(store)
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        // Bet sheet (opened from detail)
        .sheet(item: $betSheetHand) { hand in
            BetSheet(
                hand: hand,
                match: match,
                onSubmit: { amount, type in
                    betSheetHand = nil
                    Task { await submitAction(hand: hand, type: type, amount: amount) }
                }
            )
            .presentationDetents([.medium])
        }
        // All-in confirmation
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
            if newCount == 0 && !showTurnComplete {
                withAnimation { showTurnComplete = true }
            }
        }
        .task { await autoActIfNeeded() }
        .onChange(of: store.matchState?.currentRound?.hands.map(\.status)) { _, _ in
            Task { await autoActIfNeeded() }
        }
    }

    // MARK: - Section header

    private func sectionHeader(dot: Color, title: String, count: Int) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(dot)
                .frame(width: 6, height: 6)
            Text(title.uppercased())
                .font(.system(size: 10, weight: .medium))
                .tracking(1.5)
                .foregroundColor(dot == .gold500 ? .gold500 : .cream300)
            Spacer()
            Text("\(count)")
                .font(.system(size: 11))
                .foregroundColor(.cream300)
        }
        .padding(.top, 14)
        .padding(.bottom, 6)
    }

    // MARK: - Chip pill row

    private func chipPillRow(hands: [HandView], label: @escaping (HandView) -> String) -> some View {
        FlowLayout(spacing: 6) {
            ForEach(hands) { hand in
                Text(label(hand))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(pillTextColor(hand))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.black.opacity(0.25))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.gold500.opacity(0.15), lineWidth: 1)
                    )
                    .cornerRadius(10)
            }
        }
        .padding(.bottom, 4)
    }

    private func pillTextColor(_ hand: HandView) -> Color {
        if hand.status == "awaiting_runout" { return .claret }
        if hand.winnerUserId == store.currentUserId { return .gold500 }
        if hand.terminalReason == "fold" { return .cream300 }
        return .cream200
    }

    private func resolvedPillText(_ hand: HandView) -> String {
        if hand.status == "awaiting_runout" {
            return "H\(hand.handIndex + 1) \u{00B7} All-In \u{00B7} Pot \(hand.pot)"
        }
        if hand.terminalReason == "fold" {
            return "H\(hand.handIndex + 1) \u{00B7} Folded"
        }
        if hand.winnerUserId == store.currentUserId {
            return "H\(hand.handIndex + 1) \u{00B7} Won \(hand.pot)"
        }
        if hand.winnerUserId != nil {
            return "H\(hand.handIndex + 1) \u{00B7} Lost"
        }
        return "H\(hand.handIndex + 1) \u{00B7} Split"
    }

    // MARK: - Turn complete overlay

    private var turnCompleteOverlay: some View {
        ZStack {
            Color.felt900.opacity(0.9).ignoresSafeArea()
            VStack(spacing: Spacing.lg) {
                Text("\u{2705}").font(.system(size: 64))
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

    // MARK: - Actions

    private func submitAction(hand: HandView, type: String, amount: Int? = nil) async {
        await store.submitAction(handId: hand.handId, type: type, amount: amount)
        await autoActIfNeeded()
    }

    /// When available chips are 0, auto-act all remaining pending hands:
    /// - No bet facing → check
    /// - Bet facing → fold (can't call with 0 chips)
    private func autoActIfNeeded() async {
        guard !isAutoChecking else { return }
        guard let currentRound = store.matchState?.currentRound else { return }
        let available = store.matchState?.myAvailable ?? 0
        guard available == 0 else { return }

        let pending = currentRound.hands.filter { $0.isPendingAction }
        guard !pending.isEmpty else { return }

        isAutoChecking = true

        // Optimistically clear all pending hands from the UI immediately
        let actionsToTake = pending.map { hand in
            (hand: hand, action: hand.facingBet ? "fold" : "check")
        }
        for (hand, action) in actionsToTake {
            store.optimisticallyResolveHand(handId: hand.handId, action: action)
        }

        // Fire server calls (order matters for chip accounting)
        for (hand, action) in actionsToTake {
            await store.submitAction(handId: hand.handId, type: action)
        }

        isAutoChecking = false
    }
}

// MARK: - Compact Hand Card

struct CompactHandCard: View {
    let hand: HandView
    let myAvailable: Int

    var body: some View {
        HStack(spacing: 10) {
            // Hole cards
            HStack(spacing: 2) {
                ForEach(hand.myHole, id: \.self) { card in
                    PlayingCardView(card: card, size: .small)
                }
            }

            // Info
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text("Hand \(hand.handIndex + 1)")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.cream100)
                    Text("\u{00B7}")
                        .foregroundColor(.cream300)
                    Text(hand.street.capitalized)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.gold500)

                    Spacer()

                    if hand.facingBet {
                        Text("Facing \(hand.callCost)")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.gold500)
                    } else {
                        Text("Check to you")
                            .font(.system(size: 12))
                            .foregroundColor(.cream300)
                    }
                }

                Text(hand.actionSummary.isEmpty ? "Pot \(hand.pot)" : hand.actionSummary)
                    .font(.system(size: 11))
                    .foregroundColor(.cream300)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            // Chevron
            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.cream300)
        }
        .padding(10)
        .background(
            LinearGradient(
                colors: [Color.gold500.opacity(0.04), Color.black.opacity(0.15)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.gold500.opacity(0.5), lineWidth: 1)
        )
        .cornerRadius(12)
        .padding(.bottom, 8)
    }
}

// MARK: - Hand Action Detail Sheet

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
                    // Header
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

                    // Street tag
                    Text(hand.street.uppercased())
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(0.5)
                        .foregroundColor(.gold500)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.gold500.opacity(0.12))
                        .cornerRadius(4)
                        .padding(.top, 12)

                    // Cards
                    HStack(alignment: .top, spacing: 16) {
                        // My cards
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

                        // Board
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

                    // Action log
                    if let detail = handDetail {
                        actionLogView(detail: detail)
                    } else if isLoading {
                        ProgressView()
                            .tint(.gold500)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 16)
                    }

                    // Facing banner
                    facingBanner
                        .padding(.top, 12)

                    // Pot line
                    HStack {
                        Text("Pot:")
                            .font(.system(size: 12))
                            .foregroundColor(.cream300)
                        Text("\(hand.pot)")
                            .font(.custom("Georgia", size: 16))
                            .foregroundColor(.cream100)
                        Spacer()
                        Text("Your bet: \(hand.myReserved)")
                            .font(.system(size: 12))
                            .foregroundColor(.cream300)
                    }
                    .padding(.top, 8)

                    // Action buttons
                    actionButtons
                        .padding(.top, 14)
                        .padding(.bottom, 20)
                }
                .padding(.horizontal, 18)
            }
        }
        .task {
            do {
                handDetail = try await APIClient.shared.getHandDetail(handId: hand.handId)
            } catch {
                // Fall back to no detail
            }
            isLoading = false
        }
    }

    // MARK: - Action log

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
            return "FLOP \u{00B7} \(cards)"
        case "turn":
            let card = board.count >= 4 ? board[3] : ""
            return "TURN \u{00B7} \(card)"
        case "river":
            let card = board.count >= 5 ? board[4] : ""
            return "RIVER \u{00B7} \(card)"
        default: return street.uppercased()
        }
    }

    private var opponentFirstName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opp"
    }

    // MARK: - Facing banner

    private var facingBanner: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(Color.gold500.opacity(0.12))
                    .frame(width: 32, height: 32)
                Text(hand.facingBet ? "\u{2192}" : "\u{2713}")
                    .font(.system(size: 16))
                    .foregroundColor(.gold500)
            }

            VStack(alignment: .leading, spacing: 2) {
                if hand.facingBet {
                    Text("Facing a bet of")
                        .font(.system(size: 13))
                        .foregroundColor(.cream200)
                    Text("\(hand.callCost)")
                        .font(.custom("Georgia", size: 22))
                        .foregroundColor(.gold500)
                } else {
                    Text("No bet facing you")
                        .font(.system(size: 13))
                        .foregroundColor(.cream200)
                    Text("Check or bet")
                        .font(.system(size: 11))
                        .foregroundColor(.cream300)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(hand.facingBet ? "After call" : "Available")
                    .font(.system(size: 10))
                    .foregroundColor(.cream300)
                Text("\(hand.facingBet ? match.myAvailable - hand.callCost : match.myAvailable)")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.cream200)
            }
        }
        .padding(12)
        .background(Color.gold500.opacity(0.06))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.gold500.opacity(0.25), lineWidth: 1)
        )
        .cornerRadius(10)
    }

    // MARK: - Action buttons

    private var actionButtons: some View {
        HStack(spacing: 8) {
            if hand.facingBet {
                actionButton("Fold", style: .fold) { onAction("fold", nil) }
                let canAfford = match.myAvailable >= hand.callCost
                if canAfford {
                    actionButton("Call \(hand.callCost)", style: .primary) { onAction("call", nil) }
                    if match.myAvailable > hand.callCost {
                        actionButton("Raise", style: .neutral) { onAction("raise", nil) }
                    }
                }
                if match.myAvailable > 0 {
                    actionButton("All-In", style: .allIn) { onAction("all_in", nil) }
                }
            } else {
                actionButton("Check", style: .primary) { onAction("check", nil) }
                if match.myAvailable > 0 {
                    actionButton("Bet", style: .neutral) { onAction("bet", nil) }
                    actionButton("All-In", style: .allIn) { onAction("all_in", nil) }
                }
            }
        }
    }

    enum ButtonStyleType { case fold, primary, neutral, allIn }

    private func actionButton(_ title: String, style: ButtonStyleType, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .foregroundColor(buttonForeground(style))
                .background(buttonBackground(style))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(buttonBorder(style), lineWidth: 1)
                )
                .cornerRadius(10)
        }
    }

    private func buttonForeground(_ style: ButtonStyleType) -> Color {
        switch style {
        case .fold: return .claret
        case .primary: return .gold500
        case .neutral: return .cream100
        case .allIn: return .cream200
        }
    }

    private func buttonBackground(_ style: ButtonStyleType) -> Color {
        switch style {
        case .fold: return Color.claret.opacity(0.08)
        case .primary: return Color.gold500.opacity(0.15)
        case .neutral: return Color.black.opacity(0.2)
        case .allIn: return Color.black.opacity(0.2)
        }
    }

    private func buttonBorder(_ style: ButtonStyleType) -> Color {
        switch style {
        case .fold: return Color.claret.opacity(0.4)
        case .primary: return Color.gold500.opacity(0.6)
        case .neutral: return Color.gold500.opacity(0.25)
        case .allIn: return Color.claret.opacity(0.3)
        }
    }
}

// MARK: - Flow Layout (wrapping horizontal pills)

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
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

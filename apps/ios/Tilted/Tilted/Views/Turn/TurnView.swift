import SwiftUI

// MARK: - Turn View — cart flow (spec §6)
//
// A turn is composed as a batch: the player clicks through each pending
// hand on the board and *queues* a decision (nothing is sent yet), then
// reviews everything on the cart and submits the whole turn as one
// all-or-nothing request. Tapping a cart row returns to that hand's board
// to change the queued decision. The board CX itself is unchanged.

/// One queued, not-yet-submitted decision for a hand.
struct QueuedDecision: Equatable {
    let type: String        // fold / check / call / bet / raise / all_in
    let amount: Int?        // committed chips for bet/raise/all_in
    let clientTxId: String  // stable, so a retried submit dedupes server-side

    var label: String {
        switch type {
        case "fold": return "Fold"
        case "check": return "Check"
        case "call": return "Call"
        case "bet": return "Bet \(amount ?? 0)"
        case "raise": return "Raise — commit \(amount ?? 0)"
        case "all_in": return "All-in \(amount ?? 0)"
        default: return type
        }
    }
}

struct TurnView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let match: MatchState
    let round: RoundView

    @State private var focusedHandId: String?
    @State private var betSheetHand: HandView?
    @State private var allInConfirmHand: HandView?
    @State private var detailSheetHand: HandView?

    @State private var showCart = false
    @State private var isSubmitting = false
    @State private var turnSent = false

    // Cart lives in the store (survives leaving/returning to the turn) —
    // this is a proxy for readability. Scoped to the round in `.task`.
    private var cart: [String: QueuedDecision] {
        get { store.turnCart }
        nonmutating set { store.turnCart = newValue }
    }

    // MARK: - Live data

    private var liveHands: [HandView] {
        store.matchState?.currentRound?.hands ?? round.hands
    }

    /// Hands that need a decision this turn.
    private var pendingHands: [HandView] {
        liveHands.filter { $0.isPendingAction }
    }

    private var undecidedHands: [HandView] {
        pendingHands
            .filter { cart[$0.handId] == nil }
            .sorted { ($0.streetOrder, $0.handIndex) < ($1.streetOrder, $1.handIndex) }
    }

    private var focusedHand: HandView? {
        if let id = focusedHandId,
           let found = liveHands.first(where: { $0.handId == id }) {
            return found
        }
        return undecidedHands.first ?? pendingHands.first ?? liveHands.first
    }

    private var liveMatch: MatchState { store.matchState ?? match }
    private var liveRound: RoundView { liveMatch.currentRound ?? round }

    private var myRole: String { liveRound.myRole }
    private var smallBlind: Int { 5 }
    private var bigBlind: Int { 10 }

    // MARK: - Cart accounting

    /// Chips a queued decision commits beyond what's already reserved.
    private func cost(_ decision: QueuedDecision, hand: HandView) -> Int {
        switch decision.type {
        case "fold", "check": return 0
        case "call": return hand.callCost
        case "bet", "raise", "all_in": return decision.amount ?? 0
        default: return 0
        }
    }

    private var cartCommitted: Int {
        cart.reduce(0) { acc, entry in
            guard let hand = liveHands.first(where: { $0.handId == entry.key }) else { return acc }
            return acc + cost(entry.value, hand: hand)
        }
    }

    /// Provisional available after the queued bets (warn-only — the server
    /// is the final gate).
    private var provisionalAvailable: Int { liveMatch.myAvailable - cartCommitted }
    private var isOverCommitted: Bool { provisionalAvailable < 0 }
    private var allDecided: Bool { !pendingHands.isEmpty && undecidedHands.isEmpty }

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

                            Button {
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
                    Spacer()
                    Text("No hand to focus")
                        .font(.system(size: 13))
                        .foregroundColor(.cream300)
                    Spacer()
                }

                reviewBar

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

            if showCart {
                cartOverlay
                    .transition(.opacity)
                    .zIndex(3)
            }

            if turnSent { turnCompleteOverlay.zIndex(4) }
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
                    queue(hand: hand, type: type, amount: amount)
                }
            )
            .presentationDetents([.medium])
        }
        .alert("All In?", isPresented: Binding(
            get: { allInConfirmHand != nil },
            set: { if !$0 { allInConfirmHand = nil } }
        )) {
            Button("Queue All-In", role: .destructive) {
                if let hand = allInConfirmHand {
                    allInConfirmHand = nil
                    // All-in commits every provisional chip that remains,
                    // plus whatever this hand already has room for.
                    let amount = max(0, provisionalAvailable)
                    queue(hand: hand, type: "all_in", amount: amount)
                }
            }
            Button("Cancel", role: .cancel) { allInConfirmHand = nil }
        } message: {
            Text("This queues every remaining chip on this hand. You can still change it before submitting.")
        }
        .task {
            // Scope the persisted cart to this round — drop a stale cart
            // left over from a previous round, but keep one for THIS round
            // if the user stepped away and came back (#1).
            if store.turnCartRoundId != liveRound.roundId {
                store.turnCart = [:]
                store.turnCartRoundId = liveRound.roundId
            }
            if focusedHandId == nil {
                focusedHandId = undecidedHands.first?.handId ?? pendingHands.first?.handId ?? round.hands.first?.handId
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        MatchHeaderBar(
            myAvailable: provisionalAvailable,
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
                    Text("\(undecidedHands.count) left")
                        .font(.system(size: 10))
                        .foregroundColor(.cream300)
                }
            )
        )
    }

    private func dotColor(for hand: HandView) -> Color {
        if cart[hand.handId] != nil { return .gold500 }             // queued
        if hand.isPendingAction { return Color.gold500.opacity(0.3) } // needs a decision
        if hand.status == "complete" {
            return hand.winnerUserId == store.currentUserId
                ? Color(hex: 0x4ea878) : Color.cream400.opacity(0.4)
        }
        return Color.cream300.opacity(0.25)
    }

    // MARK: - Review bar (enter the cart)

    @ViewBuilder
    private var reviewBar: some View {
        if !pendingHands.isEmpty {
            Button {
                focusedHandId = focusedHand?.handId
                withAnimation { showCart = true }
            } label: {
                HStack {
                    Text(allDecided ? "Review turn" : "Review turn \u{2014} \(undecidedHands.count) still to decide")
                        .font(.system(size: 13, weight: .semibold))
                    Spacer()
                    Text("\(pendingHands.count - undecidedHands.count)/\(pendingHands.count)")
                        .font(.system(size: 12))
                    Image(systemName: "chevron.up")
                        .font(.system(size: 11, weight: .bold))
                }
                .foregroundColor(allDecided ? .felt800 : .cream100)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(
                    allDecided
                        ? AnyView(LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom))
                        : AnyView(Color.black.opacity(0.35))
                )
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Action bar (queues, does not submit)

    @ViewBuilder
    private func actionBar(for hand: HandView) -> some View {
        if hand.isPendingAction {
            VStack(spacing: 8) {
                HStack {
                    if let queued = cart[hand.handId] {
                        HStack(spacing: 5) {
                            Image(systemName: "cart.fill").font(.system(size: 10))
                            Text("Queued: \(queued.label)")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundColor(.gold500)
                    } else if hand.facingBet {
                        Text("Facing \(hand.callCost) to call")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.gold500)
                    } else {
                        Text("Check available")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.gold500)
                    }
                    Spacer()
                    Text("Avail: \(provisionalAvailable)")
                        .font(.system(size: 10))
                        .foregroundColor(isOverCommitted ? .claret : .cream300)
                }
                HStack(spacing: 6) {
                    if hand.facingBet {
                        actionBtn("Fold", style: .fold) { queue(hand: hand, type: "fold", amount: nil) }
                        actionBtn("Call \(hand.callCost)", style: .call) { queue(hand: hand, type: "call", amount: nil) }
                        actionBtn("Raise", style: .primary) { handleAction(hand: hand, type: "raise", amount: nil) }
                        actionBtn("All-In", style: .allIn) { handleAction(hand: hand, type: "all_in", amount: nil) }
                    } else {
                        actionBtn("Check", style: .call) { queue(hand: hand, type: "check", amount: nil) }
                        actionBtn("Bet", style: .primary) { handleAction(hand: hand, type: "bet", amount: nil) }
                        actionBtn("All-In", style: .allIn) { handleAction(hand: hand, type: "all_in", amount: nil) }
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
                Text("Waiting on \(match.opponent.displayName.components(separatedBy: " ").first ?? "opponent")")
                    .font(.system(size: 12))
                    .foregroundColor(.cream200)
            }
        } else if hand.status == "complete" {
            let outcome = HandOutcome.make(
                terminalReason: hand.terminalReason,
                foldStreet: hand.foldStreet,
                winnerUserId: hand.winnerUserId,
                currentUserId: store.currentUserId,
                myResolvedNet: hand.myResolvedNet,
                status: hand.status
            )
            HStack(spacing: 6) {
                Text(outcome.label)
                    .font(.system(size: 11, weight: .semibold))
                if let net = outcome.netText {
                    Text(net).font(.custom("Georgia", size: 13).bold())
                }
            }
            .foregroundColor(outcome.tint)
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

    // MARK: - Cart overlay (review / checkout)

    private var cartOverlay: some View {
        ZStack(alignment: .bottom) {
            Color.felt900.opacity(0.96).ignoresSafeArea()
                .onTapGesture { withAnimation { showCart = false } }

            VStack(spacing: 0) {
                HStack {
                    Text("Review your turn")
                        .font(.custom("Georgia", size: 22))
                        .foregroundColor(.cream100)
                    Spacer()
                    Button { withAnimation { showCart = false } } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.cream200)
                            .frame(width: 30, height: 30)
                            .background(Color.cream100.opacity(0.08))
                            .clipShape(Circle())
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 8)

                // Chip bar
                HStack {
                    chipStat("Available", value: provisionalAvailable, tint: isOverCommitted ? .claret : .gold500)
                    chipStat("Reserved", value: liveMatch.myReserved + cartCommitted, tint: .cream100)
                    chipStat("In cart", value: cartCommitted, tint: Color(hex: 0x8fb9ff))
                }
                .padding(.horizontal, 16)

                if isOverCommitted {
                    Text("\u{26A0} Over-committed by \(-provisionalAvailable) \u{2014} you can still submit, but the server will reject the whole turn.")
                        .font(.system(size: 11))
                        .foregroundColor(.claret)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .padding(.top, 6)
                }

                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(pendingHands.sorted { ($0.streetOrder, $0.handIndex) < ($1.streetOrder, $1.handIndex) }) { hand in
                            cartRow(hand: hand)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }

                if let err = store.error {
                    Text(err)
                        .font(.system(size: 12))
                        .foregroundColor(.claret)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 6)
                }

                Button {
                    Task { await submitTurn() }
                } label: {
                    HStack {
                        if isSubmitting { ProgressView().tint(.felt800) }
                        Text(allDecided ? "Submit turn \u{2014} \(pendingHands.count) hands" : "Decide all hands to submit")
                            .font(.system(size: 15, weight: .bold))
                    }
                    .foregroundColor(.felt800)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom))
                    .cornerRadius(12)
                    .opacity(allDecided && !isSubmitting ? 1 : 0.5)
                }
                .disabled(!allDecided || isSubmitting)
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
                .padding(.top, 4)
            }
        }
    }

    private func chipStat(_ label: String, value: Int, tint: Color) -> some View {
        VStack(spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .medium))
                .tracking(0.8)
                .foregroundColor(.cream400)
            Text("\(value)")
                .font(.custom("Georgia", size: 20))
                .foregroundColor(tint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Color.black.opacity(0.25))
        .cornerRadius(12)
    }

    private func cartRow(hand: HandView) -> some View {
        let queued = cart[hand.handId]
        return Button {
            focusedHandId = hand.handId
            withAnimation { showCart = false }
        } label: {
            HStack(spacing: 10) {
                HStack(spacing: 3) {
                    ForEach(hand.myHole, id: \.self) { c in
                        PlayingCardView(card: c, size: .small)
                            .scaleEffect(0.82)
                            .frame(width: 20, height: 28)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Hand \(hand.handIndex + 1) \u{00B7} \(hand.street) \u{00B7} pot \(hand.pot)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.cream50)
                    Text(queued?.label ?? "Needs action")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(queued == nil ? Color(hex: 0xe0a83a) : .gold500)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
                    .foregroundColor(.cream400)
            }
            .padding(11)
            .background(Color.felt800.opacity(0.55))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(queued == nil ? Color(hex: 0xe0a83a).opacity(0.5) : Color.white.opacity(0.08), lineWidth: 1)
            )
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Turn sent overlay

    private var turnCompleteOverlay: some View {
        ZStack {
            Color.felt900.opacity(0.94).ignoresSafeArea()
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

    // MARK: - Helpers

    private func positionHint(for hand: HandView) -> String? {
        if hand.street == "preflop" {
            return myRole == "sb" ? "you act first preflop" : "you act second preflop"
        }
        return myRole == "bb" ? "you act first postflop" : "you act second postflop"
    }

    // MARK: - Queueing & submit

    private func handleAction(hand: HandView, type: String, amount: Int?) {
        if type == "raise" || type == "bet" {
            betSheetHand = hand
        } else if type == "all_in" {
            allInConfirmHand = hand
        } else {
            queue(hand: hand, type: type, amount: amount)
        }
    }

    /// Queue a decision locally and advance to the next undecided hand.
    private func queue(hand: HandView, type: String, amount: Int?) {
        cart[hand.handId] = QueuedDecision(type: type, amount: amount, clientTxId: UUID().uuidString)
        if let next = undecidedHands.first(where: { $0.handId != hand.handId }) {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) {
                focusedHandId = next.handId
            }
        } else {
            // Everything decided — surface the cart to review & submit.
            withAnimation { showCart = true }
        }
    }

    private func submitTurn() async {
        guard allDecided, !isSubmitting else { return }
        isSubmitting = true
        store.error = nil
        let actions: [(handId: String, type: String, amount: Int?, clientTxId: String)] =
            pendingHands.compactMap { hand in
                guard let d = cart[hand.handId] else { return nil }
                return (handId: hand.handId, type: d.type, amount: d.amount, clientTxId: d.clientTxId)
            }
        let ok = await store.submitTurn(roundId: liveRound.roundId, actions: actions)
        isSubmitting = false
        if ok {
            store.clearTurnCart()
            withAnimation {
                showCart = false
                turnSent = true
            }
        }
        // On failure store.error is set and shown in the cart; user can fix.
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

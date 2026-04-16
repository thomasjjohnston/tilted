import SwiftUI

struct TurnView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let match: MatchState
    let round: RoundView
    @State private var betSheetHand: HandView?
    @State private var allInConfirmHand: HandView?
    @State private var showTurnComplete = false

    private var pendingHands: [HandView] {
        round.hands.filter { $0.isPendingAction }
    }

    private var completedCount: Int {
        round.hands.count - pendingHands.count
    }

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "chevron.left")
                            .foregroundColor(.cream200)
                            .font(.system(size: 20))
                    }

                    Spacer()

                    Text("\(pendingHands.count) of 10 hands left")
                        .font(.bodySecondary)
                        .foregroundColor(.cream100)

                    Spacer()

                    Text("Avail: \(match.myAvailable)")
                        .font(.caption)
                        .foregroundColor(.gold500)
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)

                // Hand list
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(round.hands.sorted(by: { handSortOrder($0) < handSortOrder($1) })) { hand in
                            HandCardView(
                                hand: hand,
                                myRole: round.myRole,
                                onFold: { Task { await submitAction(hand: hand, type: "fold") } },
                                onCheck: { Task { await submitAction(hand: hand, type: "check") } },
                                onCall: { Task { await submitAction(hand: hand, type: "call") } },
                                onBetRaise: { betSheetHand = hand },
                                onAllIn: { allInConfirmHand = hand }
                            )
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 40)
                }
            }

            // Turn complete overlay
            if showTurnComplete {
                turnCompleteOverlay
            }
        }
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
            Button("Cancel", role: .cancel) {
                allInConfirmHand = nil
            }
        } message: {
            Text("This action cannot be undone.")
        }
        .onChange(of: pendingHands.count) { _, newCount in
            if newCount == 0 && !showTurnComplete {
                withAnimation {
                    showTurnComplete = true
                }
            }
        }
    }

    private var turnCompleteOverlay: some View {
        ZStack {
            Color.felt900.opacity(0.9).ignoresSafeArea()

            VStack(spacing: Spacing.lg) {
                Text("\u{2705}")
                    .font(.system(size: 64))

                Text("Turn sent.")
                    .font(.displayMedium)
                    .fontDesign(.serif)
                    .foregroundColor(.cream100)

                Text("Waiting on \(match.opponent.displayName.components(separatedBy: " ").first ?? "opponent").")
                    .font(.bodySecondary)
                    .foregroundColor(.cream300)

                Button("Back to Home") {
                    dismiss()
                }
                .buttonStyle(.primary)
                .padding(.horizontal, 40)
            }
        }
    }

    private func submitAction(hand: HandView, type: String, amount: Int? = nil) async {
        await store.submitAction(handId: hand.handId, type: type, amount: amount)
    }

    private func handSortOrder(_ hand: HandView) -> Int {
        if hand.isPendingAction { return 0 }
        if hand.status == "in_progress" { return 1 }
        if hand.status == "awaiting_runout" { return 2 }
        return 3
    }
}

// MARK: - Hand Card

struct HandCardView: View {
    let hand: HandView
    let myRole: String
    let onFold: () -> Void
    let onCheck: () -> Void
    let onCall: () -> Void
    let onBetRaise: () -> Void
    let onAllIn: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack {
                Text("HAND \(hand.handIndex + 1)")
                    .font(.eyebrow)
                    .tracking(1.5)
                    .foregroundColor(.cream300)

                Spacer()

                Text(hand.street.uppercased())
                    .font(.eyebrow)
                    .tracking(1)
                    .foregroundColor(.gold500)

                if hand.isTerminal {
                    Text(hand.winnerUserId != nil ? (hand.terminalReason == "fold" ? "FOLDED" : "COMPLETE") : "TIED")
                        .font(.eyebrow)
                        .tracking(1)
                        .foregroundColor(hand.terminalReason == "fold" ? .claret : .gold500)
                }
            }

            // Cards
            HStack(spacing: 4) {
                // My hole cards
                ForEach(hand.myHole, id: \.self) { card in
                    PlayingCardView(card: card)
                }

                Spacer().frame(width: 8)

                // Board
                if hand.board.isEmpty {
                    ForEach(0..<5, id: \.self) { _ in
                        CardPlaceholderView()
                    }
                } else {
                    ForEach(hand.board, id: \.self) { card in
                        PlayingCardView(card: card)
                    }
                    ForEach(0..<(5 - hand.board.count), id: \.self) { _ in
                        CardPlaceholderView()
                    }
                }
            }

            // Pot and chips
            HStack {
                Text("Pot: \(hand.pot)")
                    .font(.bodySecondary)
                    .foregroundColor(.cream100)

                Spacer()

                Text("My bet: \(hand.myReserved)")
                    .font(.caption)
                    .foregroundColor(.cream300)
            }

            // Action buttons (only for pending hands)
            if hand.isPendingAction {
                HStack(spacing: 6) {
                    // Determine available actions based on state
                    if hand.opponentReserved > hand.myReserved {
                        // Facing a bet
                        ActionButtonView(title: "Fold", action: onFold)
                        ActionButtonView(title: "Call", isPrimary: true, action: onCall)
                        ActionButtonView(title: "Raise", action: onBetRaise)
                    } else {
                        // No bet facing
                        ActionButtonView(title: "Check", isPrimary: true, action: onCheck)
                        ActionButtonView(title: "Bet", action: onBetRaise)
                    }
                    ActionButtonView(title: "All-In", action: onAllIn)
                }
            }
        }
        .padding(12)
        .background(
            LinearGradient(
                colors: [Color.white.opacity(0.04), Color.black.opacity(0.2)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(
                    hand.isPendingAction
                    ? Color.gold500.opacity(0.7)
                    : Color.gold500.opacity(0.22),
                    lineWidth: 1
                )
        )
        .cornerRadius(14)
        .opacity(hand.isTerminal ? 0.6 : 1)
    }
}

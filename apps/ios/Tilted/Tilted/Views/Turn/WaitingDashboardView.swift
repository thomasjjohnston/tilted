import SwiftUI

// Compact dashboard surfacing the state of all 10 hands while the
// opponent is acting on their turn. Each card shows your hole cards
// (always revealed to you), board cards revealed so far, pot and street,
// and the action the opponent is currently facing.
//
// Tap a card to drill into a read-only felt view for that hand.

struct WaitingDashboardView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let match: MatchState
    let round: RoundView

    @State private var focusedHandId: String?

    private var liveMatch: MatchState { store.matchState ?? match }
    private var liveRound: RoundView { liveMatch.currentRound ?? round }
    private var hands: [HandView] { liveRound.hands.sorted { $0.handIndex < $1.handIndex } }

    private var opponentName: String {
        liveMatch.opponent.displayName.components(separatedBy: " ").first ?? "Opponent"
    }

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            VStack(spacing: 0) {
                header
                ScrollView {
                    VStack(spacing: 12) {
                        statusBanner
                        currentlyOnCard
                        LazyVGrid(columns: [
                            GridItem(.flexible(), spacing: 8),
                            GridItem(.flexible(), spacing: 8)
                        ], spacing: 8) {
                            ForEach(hands) { hand in
                                handCard(hand: hand)
                                    .onTapGesture { focusedHandId = hand.handId }
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 14)
                }
                .scrollIndicators(.hidden)
                .refreshable { await store.refresh() }
            }

            if let id = focusedHandId,
               let hand = hands.first(where: { $0.handId == id }) {
                ReadOnlyHandFocus(
                    hand: hand,
                    match: liveMatch,
                    myRole: liveRound.myRole,
                    smallBlind: 5,
                    bigBlind: 10,
                    onDismiss: { focusedHandId = nil }
                )
                .transition(.opacity)
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .foregroundColor(.cream200)
                    .font(.system(size: 18, weight: .medium))
                    .frame(width: 30, height: 30)
            }
            Spacer()
            VStack(spacing: 0) {
                Text("MATCH")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1.5)
                    .foregroundColor(.cream300)
                Text(liveMatch.opponent.displayName)
                    .font(.custom("Georgia", size: 14))
                    .foregroundColor(.cream100)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 0) {
                Text("AVAILABLE")
                    .font(.system(size: 8, weight: .semibold))
                    .tracking(1.2)
                    .foregroundColor(.cream300)
                Text("\(liveMatch.myAvailable)")
                    .font(.custom("Georgia", size: 15).bold())
                    .foregroundColor(.gold500)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.felt800.opacity(0.95))
        .overlay(
            Rectangle().fill(Color.gold500.opacity(0.1)).frame(height: 1),
            alignment: .bottom
        )
    }

    private var statusBanner: some View {
        let oppPending = liveRound.handsPendingOpponent
        return HStack(spacing: 12) {
            Circle()
                .fill(Color.gold500)
                .frame(width: 10, height: 10)
                .shadow(color: .gold500, radius: 6)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(opponentName) is responding")
                    .font(.custom("Georgia", size: 16))
                    .foregroundColor(.cream100)
                Text("\(oppPending) of 10 hands awaiting them")
                    .font(.system(size: 11))
                    .foregroundColor(.cream300)
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            LinearGradient(
                colors: [Color.gold500.opacity(0.08), Color.black.opacity(0.2)],
                startPoint: .leading, endPoint: .trailing
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.gold500.opacity(0.25), lineWidth: 1)
        )
        .cornerRadius(12)
    }

    // Hands the opponent is currently facing action on — surface the one
    // with the biggest pot first as the "what they're thinking about" cue.
    @ViewBuilder
    private var currentlyOnCard: some View {
        let acting = hands
            .filter { $0.status == "in_progress" && !$0.actionOnMe }
            .sorted { $0.pot > $1.pot }
        if let top = acting.first {
            let oppName = opponentName
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(Color.gold500.opacity(0.15))
                        .frame(width: 40, height: 40)
                    Text("H\(top.handIndex + 1)")
                        .font(.custom("Georgia", size: 14).bold())
                        .foregroundColor(.gold500)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("Currently on Hand \(top.handIndex + 1)")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.cream100)
                    Text("\(top.street.capitalized) · pot \(top.pot) · \(oppName) to act")
                        .font(.system(size: 10))
                        .foregroundColor(.cream300)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
                    .foregroundColor(.cream300)
            }
            .padding(12)
            .background(Color.black.opacity(0.25))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.gold500.opacity(0.3), lineWidth: 1)
            )
            .cornerRadius(12)
            .onTapGesture { focusedHandId = top.handId }
        }
    }

    // MARK: - Per-hand mini card

    private func handCard(hand: HandView) -> some View {
        let oppActing = hand.status == "in_progress" && !hand.actionOnMe
        let resolved = hand.status == "complete"
        let won = hand.winnerUserId == store.currentUserId
        let net = hand.myResolvedNet ?? 0

        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("H\(hand.handIndex + 1)")
                    .font(.custom("Georgia", size: 13).bold())
                    .foregroundColor(.cream100)
                Spacer()
                Text(streetLabel(hand))
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1)
                    .foregroundColor(streetColor(hand))
            }

            // Your hole cards row — always visible (they're yours)
            HStack(spacing: 3) {
                Text("YOU")
                    .font(.system(size: 8, weight: .semibold))
                    .tracking(1)
                    .foregroundColor(.cream400)
                ForEach(hand.myHole, id: \.self) { c in
                    PlayingCardView(card: c, size: .small)
                        .scaleEffect(0.72)
                        .frame(width: 17, height: 25)
                }
            }

            // Board — revealed to current street
            HStack(spacing: 3) {
                Text("BRD")
                    .font(.system(size: 8, weight: .semibold))
                    .tracking(1)
                    .foregroundColor(.cream400)
                if hand.board.isEmpty {
                    Text("—")
                        .font(.system(size: 10))
                        .foregroundColor(.cream400)
                } else {
                    ForEach(hand.board, id: \.self) { c in
                        PlayingCardView(card: c, size: .small)
                            .scaleEffect(0.62)
                            .frame(width: 14, height: 21)
                    }
                }
            }

            Divider().overlay(Color.gold500.opacity(0.12))

            statusLine(hand, oppActing: oppActing, resolved: resolved, won: won, net: net)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBg(oppActing: oppActing, resolved: resolved, won: won))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(cardBorder(oppActing: oppActing, resolved: resolved, won: won), lineWidth: 1)
        )
        .cornerRadius(12)
    }

    @ViewBuilder
    private func statusLine(_ hand: HandView, oppActing: Bool, resolved: Bool, won: Bool, net: Int) -> some View {
        if resolved {
            HStack {
                Text(won ? "Won" : (hand.winnerUserId == nil ? "Split" : "Lost"))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(won ? Color(hex: 0x4ea878) : .cream300)
                Spacer()
                Text(net >= 0 ? "+\(net)" : "\(net)")
                    .font(.custom("Georgia", size: 11).bold())
                    .foregroundColor(net >= 0 ? Color(hex: 0x4ea878) : .claret)
            }
        } else if oppActing {
            Text(oppActingText(hand))
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.gold500)
                .lineLimit(2)
        } else {
            Text("Pot \(hand.pot)")
                .font(.system(size: 10))
                .foregroundColor(.cream300)
        }
    }

    private func oppActingText(_ hand: HandView) -> String {
        if hand.opponentReserved > hand.myReserved {
            return "→ Facing your \(hand.opponentReserved - hand.myReserved)… wait, your bet — opp to act"
        }
        return "→ \(opponentName) to act"
    }

    private func streetLabel(_ hand: HandView) -> String {
        if hand.status == "complete" {
            return "RESOLVED"
        }
        if hand.status == "awaiting_runout" {
            return "ALL-IN"
        }
        return hand.street.uppercased()
    }

    private func streetColor(_ hand: HandView) -> Color {
        if hand.status == "awaiting_runout" { return .claret }
        if hand.status == "complete" { return .cream400 }
        return .gold500
    }

    private func cardBg(oppActing: Bool, resolved: Bool, won: Bool) -> some View {
        if oppActing {
            return AnyView(
                LinearGradient(
                    colors: [Color.gold500.opacity(0.06), Color.black.opacity(0.2)],
                    startPoint: .top, endPoint: .bottom
                )
            )
        }
        if resolved && won {
            return AnyView(
                LinearGradient(
                    colors: [Color(hex: 0x4ea878).opacity(0.06), Color.black.opacity(0.18)],
                    startPoint: .top, endPoint: .bottom
                )
            )
        }
        return AnyView(
            LinearGradient(
                colors: [Color.white.opacity(0.03), Color.black.opacity(0.18)],
                startPoint: .top, endPoint: .bottom
            )
        )
    }

    private func cardBorder(oppActing: Bool, resolved: Bool, won: Bool) -> Color {
        if oppActing { return Color.gold500.opacity(0.4) }
        if resolved && won { return Color(hex: 0x4ea878).opacity(0.3) }
        if resolved { return Color.cream400.opacity(0.18) }
        return Color.gold500.opacity(0.15)
    }
}

// MARK: - Read-only hand focus overlay

struct ReadOnlyHandFocus: View {
    let hand: HandView
    let match: MatchState
    let myRole: String
    let smallBlind: Int
    let bigBlind: Int
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.felt900.opacity(0.95).ignoresSafeArea()
            VStack(spacing: 12) {
                HStack {
                    Spacer()
                    Button { onDismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(.cream200)
                            .frame(width: 32, height: 32)
                            .background(Color.black.opacity(0.3))
                            .clipShape(Circle())
                            .overlay(
                                Circle().stroke(Color.gold500.opacity(0.3), lineWidth: 1)
                            )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)

                Text("Hand \(hand.handIndex + 1) · read-only")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1)
                    .foregroundColor(.cream300)

                FeltTableView(
                    hand: hand,
                    match: match,
                    myRole: myRole,
                    smallBlind: smallBlind,
                    bigBlind: bigBlind
                )
                .padding(.horizontal, 18)

                if hand.status == "in_progress" && !hand.actionOnMe {
                    HStack(spacing: 8) {
                        Circle().fill(Color.gold500).frame(width: 8, height: 8)
                            .shadow(color: .gold500, radius: 4)
                        let oppName = match.opponent.displayName.components(separatedBy: " ").first ?? "Opp"
                        Text("\(oppName) is acting on this hand")
                            .font(.system(size: 12))
                            .foregroundColor(.cream200)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.gold500.opacity(0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.gold500.opacity(0.3), lineWidth: 1)
                    )
                    .cornerRadius(10)
                }

                Spacer()
            }
        }
    }
}

import SwiftUI

struct TurnSummaryView: View {
    let match: MatchState
    let round: RoundView
    let deliberateActions: [(handIndex: Int, summary: String)]
    let autoActedHands: [(handIndex: Int, action: String)]
    let autoActedHandViews: [HandView]
    let showdownResults: [HandView]
    let stackBefore: Int
    let onSendTurn: () -> Void

    /// Use server-confirmed available if it's less than stackBefore (meaning
    /// server has processed). Otherwise estimate from auto-fold blind losses.
    private var netChange: Int {
        let serverAvailable = match.myAvailable
        // If server has reconciled (available changed from stackBefore), use that
        if serverAvailable != stackBefore {
            return serverAvailable - stackBefore
        }
        // Fallback: estimate from auto-folded blind losses
        var net = 0
        for hand in autoActedHandViews {
            // Every folded hand loses its reserved (blind)
            if autoActedHands.contains(where: { $0.handIndex == hand.handIndex && $0.action == "fold" }) {
                net -= hand.myReserved
            }
        }
        return net
    }

    private var stackAfter: Int { stackBefore + netChange }

    private var opponentName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent"
    }

    var body: some View {
        ZStack {
            Color.felt900.opacity(0.95).ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Header
                    VStack(spacing: 4) {
                        Text("TURN COMPLETE")
                            .font(.system(size: 10, weight: .medium))
                            .tracking(1.5)
                            .foregroundColor(.gold500)
                        Text("Here's what happened")
                            .font(.custom("Georgia", size: 24))
                            .foregroundColor(.cream100)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 20)
                    .padding(.bottom, 16)

                    // Showdowns
                    if !showdownResults.isEmpty {
                        sectionEyebrow("Showdowns", color: .gold500)

                        ForEach(showdownResults) { hand in
                            showdownRow(hand: hand)
                                .padding(.bottom, 6)
                        }
                        Spacer().frame(height: 8)
                    }

                    // Your actions
                    if !deliberateActions.isEmpty {
                        sectionEyebrow("Your Actions", color: .cream300)

                        ForEach(deliberateActions, id: \.handIndex) { action in
                            Text("H\(action.handIndex + 1): \(action.summary)")
                                .font(.system(size: 12))
                                .foregroundColor(.cream200)
                                .padding(.vertical, 1)
                        }
                        Spacer().frame(height: 12)
                    }

                    // Auto-acted
                    if !autoActedHands.isEmpty {
                        sectionEyebrow("Auto-Acted (0 chips available)", color: .cream300)

                        let checks = autoActedHands.filter { $0.action == "check" }
                        let folds = autoActedHands.filter { $0.action == "fold" }

                        if !checks.isEmpty {
                            let handNums = checks.map { "H\($0.handIndex + 1)" }.joined(separator: ", ")
                            Text("\(handNums): Auto-checked (no bet facing)")
                                .font(.system(size: 12))
                                .foregroundColor(.cream300)
                                .padding(.vertical, 1)
                        }
                        if !folds.isEmpty {
                            let handNums = folds.map { "H\($0.handIndex + 1)" }.joined(separator: ", ")
                            Text("\(handNums): Auto-folded (facing bet)")
                                .font(.system(size: 12))
                                .foregroundColor(.cream300)
                                .padding(.vertical, 1)
                        }
                        Spacer().frame(height: 12)
                    }

                    // Divider
                    Rectangle()
                        .fill(LinearGradient(colors: [.clear, .gold600, .clear], startPoint: .leading, endPoint: .trailing))
                        .frame(height: 1)
                        .opacity(0.5)
                        .padding(.vertical, 8)

                    // Net result
                    VStack(spacing: 4) {
                        Text("Net this turn")
                            .font(.system(size: 12))
                            .foregroundColor(.cream300)
                        Text(netChange >= 0 ? "+\(netChange)" : "\(netChange)")
                            .font(.custom("Georgia", size: 36))
                            .foregroundColor(netChange > 0 ? .gold500 : netChange < 0 ? .claret : .cream100)
                        Text("Available: \(stackBefore) \u{2192} \(stackAfter)")
                            .font(.system(size: 11))
                            .foregroundColor(.cream300)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)

                    Spacer().frame(height: 16)
                }
                .padding(.horizontal, 18)
            }

            // CTA pinned to bottom
            VStack {
                Spacer()
                Button("Send Turn \u{2192}") { onSendTurn() }
                    .buttonStyle(.primary)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)
                    .background(
                        LinearGradient(colors: [.clear, .felt900], startPoint: .top, endPoint: .bottom)
                            .frame(height: 80)
                            .offset(y: -20)
                    )
            }
        }
    }

    // MARK: - Components

    private func sectionEyebrow(_ text: String, color: Color) -> some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .medium))
            .tracking(1.5)
            .foregroundColor(color)
            .padding(.bottom, 6)
    }

    private func showdownRow(hand: HandView) -> some View {
        let won = hand.winnerUserId != nil && hand.winnerUserId != match.opponent.userId
        let lost = hand.winnerUserId == match.opponent.userId
        let borderColor = won ? Color.gold500.opacity(0.2) : Color.claret.opacity(0.2)

        return HStack {
            Text("H\(hand.handIndex + 1)")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.cream100)
                .frame(width: 28, alignment: .leading)

            HStack(spacing: 2) {
                ForEach(hand.myHole, id: \.self) { card in
                    PlayingCardView(card: card, size: .small)
                }
            }

            Text("vs")
                .font(.system(size: 10))
                .foregroundColor(.cream300)

            if let opp = hand.opponentHole {
                HStack(spacing: 2) {
                    ForEach(opp, id: \.self) { card in
                        PlayingCardView(card: card, size: .small)
                    }
                }
            }

            Spacer()

            if hand.winnerUserId == nil {
                Text("Split")
                    .font(.custom("Georgia", size: 14))
                    .foregroundColor(.cream100)
            } else {
                Text(won ? "+\(hand.pot)" : "-\(hand.myReserved)")
                    .font(.custom("Georgia", size: 16))
                    .foregroundColor(won ? .gold500 : .claret)
            }
        }
        .padding(10)
        .background(Color.black.opacity(0.2))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(borderColor, lineWidth: 1))
        .cornerRadius(10)
    }
}

import SwiftUI

struct ShowdownResultView: View {
    let hand: HandView
    let match: MatchState
    let remainingPendingCount: Int
    let hasNextPending: Bool
    let onFavorite: (Bool) -> Void
    let onBackToList: () -> Void
    let onNextHand: () -> Void

    @State private var showResult = false
    @State private var isFavorited = false

    private var opponentName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent"
    }

    // MARK: - Outcome classification

    private enum Outcome {
        case winShowdown
        case loseShowdown
        case splitPot
        case opponentFolded
        case youFolded
    }

    private var outcome: Outcome {
        if hand.terminalReason == "fold" {
            // Winner != opponent → opponent folded to us. Winner == opponent → we folded.
            let opponentWon = hand.winnerUserId == match.opponent.userId
            return opponentWon ? .youFolded : .opponentFolded
        }
        if hand.winnerUserId == nil { return .splitPot }
        let iWon = hand.winnerUserId != match.opponent.userId
        return iWon ? .winShowdown : .loseShowdown
    }

    private var eyebrowTitle: String {
        let streetLabel = (hand.street == "complete" ? "HAND" : hand.street.uppercased())
        switch outcome {
        case .winShowdown, .loseShowdown:
            return "HAND \(hand.handIndex + 1) \u{00B7} SHOWDOWN"
        case .splitPot:
            return "HAND \(hand.handIndex + 1) \u{00B7} SPLIT POT"
        case .opponentFolded, .youFolded:
            return "HAND \(hand.handIndex + 1) \u{00B7} \(streetLabel)"
        }
    }

    private var eyebrowColor: Color {
        switch outcome {
        case .winShowdown, .opponentFolded: return .gold500
        case .loseShowdown, .youFolded: return .claret
        case .splitPot: return .cream300
        }
    }

    private var resultBanner: (text: String, color: Color) {
        switch outcome {
        case .winShowdown, .opponentFolded: return ("You win", .gold500)
        case .loseShowdown, .youFolded: return ("You lose", .claret)
        case .splitPot: return ("Split pot", .cream200)
        }
    }

    private var potDeltaLabel: String {
        switch outcome {
        case .winShowdown, .opponentFolded: return "+\(hand.pot)"
        case .loseShowdown, .youFolded: return "-\(hand.myReserved)"
        case .splitPot: return "+\(hand.pot / 2)"
        }
    }

    private var potDeltaColor: Color {
        switch outcome {
        case .winShowdown, .opponentFolded: return .gold500
        case .loseShowdown, .youFolded: return .claret
        case .splitPot: return .cream100
        }
    }

    private var foldCaption: String {
        let actingStreet = hand.street == "complete" ? "" : " on the \(hand.street.lowercased())"
        switch outcome {
        case .opponentFolded:
            return "\(opponentName) folded\(actingStreet)."
        case .youFolded:
            return "You folded to \(opponentName)'s bet\(actingStreet)."
        default:
            return ""
        }
    }

    // MARK: - Body

    var body: some View {
        ZStack {
            Color.felt900.opacity(0.95).ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                Text(eyebrowTitle)
                    .font(.system(size: 10, weight: .medium))
                    .tracking(1.5)
                    .foregroundColor(eyebrowColor)

                Spacer().frame(height: 20)

                cardsRow

                Spacer().frame(height: 16)

                if !hand.board.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(hand.board, id: \.self) { card in
                            PlayingCardView(card: card, size: .small)
                        }
                    }
                    Spacer().frame(height: 16)
                }

                if !foldCaption.isEmpty {
                    Text(foldCaption)
                        .font(.system(size: 12))
                        .foregroundColor(.cream200)
                        .padding(.bottom, 8)
                }

                Rectangle()
                    .fill(LinearGradient(colors: [.clear, .gold600, .clear], startPoint: .leading, endPoint: .trailing))
                    .frame(height: 1)
                    .frame(maxWidth: 200)
                    .opacity(0.5)

                Spacer().frame(height: 16)

                if showResult {
                    resultAmount
                        .transition(.scale.combined(with: .opacity))
                }

                Spacer().frame(height: 16)

                favoriteButton

                Spacer()

                dualFooter
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)
            }
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                    showResult = true
                }
            }
        }
    }

    // MARK: - Cards row

    @ViewBuilder
    private var cardsRow: some View {
        HStack(alignment: .top, spacing: 16) {
            myColumn
            middleBadge
            opponentColumn
        }
    }

    private var myColumn: some View {
        VStack(spacing: 6) {
            Text("YOU")
                .font(.system(size: 9, weight: .medium))
                .tracking(1)
                .foregroundColor(.cream300)
            HStack(spacing: 4) {
                if hand.myHole.isEmpty {
                    CardPlaceholderView(size: .xlarge)
                    CardPlaceholderView(size: .xlarge)
                } else {
                    ForEach(hand.myHole, id: \.self) { card in
                        PlayingCardView(card: card, size: .xlarge)
                    }
                }
            }
            .shadow(color: myGlow, radius: 15)
            .opacity(myOpacity)
        }
    }

    private var opponentColumn: some View {
        VStack(spacing: 6) {
            Text(opponentName.uppercased())
                .font(.system(size: 9, weight: .medium))
                .tracking(1)
                .foregroundColor(.cream300)
            HStack(spacing: 4) {
                switch outcome {
                case .winShowdown, .loseShowdown, .splitPot:
                    if let oppHole = hand.opponentHole, !oppHole.isEmpty {
                        ForEach(Array(oppHole.enumerated()), id: \.offset) { idx, card in
                            FlippingCardView(card: card, size: .xlarge, delay: 0.25 + Double(idx) * 0.15)
                        }
                    } else {
                        CardPlaceholderView(size: .xlarge)
                        CardPlaceholderView(size: .xlarge)
                    }
                case .opponentFolded, .youFolded:
                    MuckPlaceholderView(size: .xlarge)
                    MuckPlaceholderView(size: .xlarge)
                }
            }
            .shadow(color: opponentGlow, radius: 15)
            .opacity(opponentOpacity)
        }
    }

    @ViewBuilder
    private var middleBadge: some View {
        switch outcome {
        case .splitPot:
            Text("SPLIT")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.gold500)
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(Color.gold500.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.gold500.opacity(0.3), lineWidth: 1)
                )
                .cornerRadius(8)
                .padding(.top, 24)
        default:
            ZStack {
                Circle()
                    .fill(Color.black.opacity(0.4))
                    .frame(width: 32, height: 32)
                Circle()
                    .stroke(Color.gold500.opacity(0.3), lineWidth: 1)
                    .frame(width: 32, height: 32)
                Text("vs")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.cream300)
            }
            .padding(.top, 24)
        }
    }

    private var myGlow: Color {
        switch outcome {
        case .winShowdown, .opponentFolded: return .gold500.opacity(0.25)
        default: return .clear
        }
    }

    private var opponentGlow: Color {
        switch outcome {
        case .loseShowdown: return .claret.opacity(0.2)
        default: return .clear
        }
    }

    private var myOpacity: Double {
        switch outcome {
        case .winShowdown, .opponentFolded, .splitPot: return 1.0
        case .loseShowdown, .youFolded: return 0.5
        }
    }

    private var opponentOpacity: Double {
        switch outcome {
        case .loseShowdown: return 1.0
        case .winShowdown, .opponentFolded: return 0.5
        case .splitPot, .youFolded: return 0.85
        }
    }

    // MARK: - Result amount

    private var resultAmount: some View {
        VStack(spacing: 4) {
            Text(resultBanner.text)
                .font(.system(size: 14))
                .foregroundColor(.cream300)

            Text(potDeltaLabel)
                .font(.custom("Georgia", size: 48))
                .foregroundColor(potDeltaColor)
                .scaleEffect(showResult ? 1 : 0.7)
        }
    }

    // MARK: - Favorite

    private var favoriteButton: some View {
        Button {
            isFavorited.toggle()
            onFavorite(isFavorited)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: isFavorited ? "star.fill" : "star")
                    .font(.system(size: 18))
                    .foregroundColor(isFavorited ? .gold500 : .cream300)
                Text("Bookmark this hand")
                    .font(.system(size: 11))
                    .foregroundColor(.cream300)
            }
        }
    }

    // MARK: - Dual footer

    private var dualFooter: some View {
        VStack(spacing: 8) {
            Text(remainingPendingCount == 0
                 ? "All hands handled."
                 : "\(remainingPendingCount) more pending")
                .font(.system(size: 10))
                .foregroundColor(.cream400)

            HStack(spacing: 8) {
                Button {
                    onBackToList()
                } label: {
                    Text("\u{2191} All Hands")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.cream200)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color.black.opacity(0.3))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Color.gold500.opacity(0.3), lineWidth: 1)
                        )
                        .cornerRadius(10)
                }
                .frame(maxWidth: 130)

                Button {
                    onNextHand()
                } label: {
                    Text("Next Hand \u{2192}")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.felt800)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(
                            LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom)
                        )
                        .cornerRadius(10)
                        .shadow(color: .black.opacity(0.25), radius: 0, y: 3)
                }
                .disabled(!hasNextPending)
                .opacity(hasNextPending ? 1 : 0.4)
            }
        }
    }
}

// MARK: - Muck placeholder (dashed outline)

struct MuckPlaceholderView: View {
    var size: PlayingCardView.CardSize = .xlarge

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size.cornerRadius)
                .fill(Color.black.opacity(0.25))
            RoundedRectangle(cornerRadius: size.cornerRadius)
                .strokeBorder(
                    Color.cream300.opacity(0.4),
                    style: StrokeStyle(lineWidth: 1, dash: [3, 3])
                )
            Text("?")
                .font(.custom("Georgia", size: size.height * 0.4))
                .foregroundColor(.cream400)
        }
        .frame(width: size.width, height: size.height)
    }
}

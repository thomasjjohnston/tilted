import SwiftUI

// Full-screen celebration when the opponent folded one of your hands.
// Scales the moment to the pot size: a preflop steal gets a small
// "Blinds, yours." pickup; a river-fold payday gets a big "You won." moment.
//
// Shows what each player held — your hand face-up (revealed), opponent's
// cards as a muck stack (server discards the folder's hole cards). The
// fold street is surfaced explicitly so preflop folds read differently
// from river folds.

struct HandWonView: View {
    let hand: HandView
    let match: MatchState
    let onContinue: () -> Void

    @State private var showAmount = false

    private var opponentName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent"
    }

    private var foldStreet: String {
        hand.foldStreet ?? hand.street
    }

    private var isBigPot: Bool {
        // River fold or pot > 100 BB
        foldStreet == "river" || hand.pot >= 200
    }

    private var headline: String {
        switch foldStreet {
        case "preflop": return "Blinds, yours."
        case "flop": return "Pot, yours."
        case "turn": return "Pot, yours."
        case "river": return "You won."
        default: return "You won."
        }
    }

    private var subtitle: String {
        switch foldStreet {
        case "preflop": return "\(opponentName) folded preflop — you stole the blinds"
        case "flop": return "\(opponentName) folded on the flop"
        case "turn": return "\(opponentName) folded on the turn"
        case "river": return "\(opponentName) folded on the river"
        default: return "\(opponentName) folded"
        }
    }

    private var netAmount: Int {
        hand.myResolvedNet ?? hand.pot
    }

    var body: some View {
        ZStack {
            background

            VStack(spacing: 0) {
                Spacer()

                Text("HAND \(hand.handIndex + 1) · \(opponentName.uppercased()) FOLDED")
                    .font(.system(size: 10, weight: .medium))
                    .tracking(3)
                    .foregroundColor(.gold500)
                    .padding(.bottom, 10)

                Text(headline)
                    .font(.custom("Georgia", size: isBigPot ? 38 : 32))
                    .foregroundColor(.cream100)
                    .padding(.bottom, 4)

                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundColor(.cream300)
                    .padding(.bottom, 26)

                potDisplay
                    .scaleEffect(showAmount ? 1 : 0.85)
                    .opacity(showAmount ? 1 : 0)

                detailCard
                    .padding(.horizontal, 28)
                    .padding(.top, 24)

                Spacer()

                continueButton
                    .padding(.horizontal, 28)
                    .padding(.bottom, 32)
            }
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                withAnimation(.spring(response: 0.55, dampingFraction: 0.72)) {
                    showAmount = true
                }
            }
        }
    }

    private var background: some View {
        ZStack {
            RadialGradient(
                gradient: Gradient(colors: [.felt500, .felt700, .felt800]),
                center: .top,
                startRadius: 0,
                endRadius: 600
            )
            RadialGradient(
                gradient: Gradient(colors: [
                    Color.gold500.opacity(0.22),
                    .clear
                ]),
                center: UnitPoint(x: 0.5, y: 0.3),
                startRadius: 0,
                endRadius: 320
            )
        }
        .ignoresSafeArea()
    }

    private var potDisplay: some View {
        VStack(spacing: 6) {
            Text("POT COLLECTED")
                .font(.system(size: 10, weight: .medium))
                .tracking(2)
                .foregroundColor(.cream300)

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("+")
                    .font(.custom("Georgia", size: isBigPot ? 44 : 36))
                    .foregroundColor(Color(hex: 0x4ea878))
                Text("\(netAmount)")
                    .font(.custom("Georgia", size: isBigPot ? 60 : 50))
                    .foregroundColor(.gold500)
            }
            .shadow(color: Color.gold500.opacity(0.35), radius: 18)
        }
    }

    private var detailCard: some View {
        VStack(spacing: 0) {
            detailRow(label: "Your hand") {
                HStack(spacing: 3) {
                    ForEach(hand.myHole, id: \.self) { card in
                        PlayingCardView(card: card, size: .small)
                    }
                }
            }

            if !hand.board.isEmpty {
                divider
                detailRow(label: "Board") {
                    HStack(spacing: 3) {
                        ForEach(hand.board, id: \.self) { card in
                            PlayingCardView(card: card, size: .small)
                        }
                    }
                }
            }

            divider
            detailRow(label: "\(opponentName)'s cards") {
                HStack(spacing: 3) {
                    MuckPlaceholderView(size: .small)
                    MuckPlaceholderView(size: .small)
                }
            }

            divider
            detailRow(label: "Folded on") {
                Text(foldStreet.capitalized)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.gold500)
            }
        }
        .padding(16)
        .background(Color.black.opacity(0.3))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.gold500.opacity(0.22), lineWidth: 1)
        )
        .cornerRadius(14)
    }

    private func detailRow<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.cream300)
            Spacer()
            content()
        }
        .padding(.vertical, 8)
    }

    private var divider: some View {
        Rectangle()
            .fill(Color.gold500.opacity(0.1))
            .frame(height: 1)
    }

    private var continueButton: some View {
        Button(action: onContinue) {
            Text("Continue →")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(.felt800)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(
                    LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom)
                )
                .cornerRadius(12)
                .shadow(color: .black.opacity(0.3), radius: 0, y: 3)
        }
    }
}

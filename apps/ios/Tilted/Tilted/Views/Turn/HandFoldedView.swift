import SwiftUI

/// Full-screen completion screen shown when *you* folded a hand.
/// Mirrors `HandWonView` for the opposite outcome. Headline scales to
/// the size of the loss (just blinds vs full pot committed).
struct HandFoldedView: View {
    let hand: HandView
    let match: MatchState
    let onContinue: () -> Void

    @State private var showAmount = false

    private var opponentName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent"
    }

    private var foldStreet: String { hand.foldStreet ?? hand.street }

    private var isBigLoss: Bool {
        foldStreet == "river" || hand.myReserved >= 100
    }

    private var headline: String {
        switch foldStreet {
        case "preflop": return "Blinds, gone."
        case "flop": return "Folded the flop."
        case "turn": return "Folded the turn."
        case "river": return "Lost it on the river."
        default: return "Folded."
        }
    }

    private var subtitle: String {
        switch foldStreet {
        case "preflop": return "You folded preflop to \(opponentName)"
        case "flop": return "You folded the flop to \(opponentName)'s bet"
        case "turn": return "You folded the turn to \(opponentName)'s bet"
        case "river": return "You folded the river to \(opponentName)'s bet"
        default: return "You folded to \(opponentName)"
        }
    }

    /// Amount lost — from server snapshot if present, else myReserved.
    private var lostAmount: Int {
        if let net = hand.myResolvedNet { return -net }
        return hand.myReserved
    }

    var body: some View {
        ZStack {
            background

            VStack(spacing: 0) {
                MatchHeaderBar(
                    myAvailable: match.myAvailable,
                    opponentName: opponentName,
                    opponentAvailable: match.opponentAvailable
                )

                Spacer()

                Text("HAND \(hand.handIndex + 1) · YOU FOLDED")
                    .font(.system(size: 10, weight: .medium))
                    .tracking(3)
                    .foregroundColor(.claret)
                    .padding(.bottom, 10)

                Text(headline)
                    .font(.custom("Georgia", size: isBigLoss ? 38 : 32))
                    .foregroundColor(.cream100)
                    .padding(.bottom, 4)

                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundColor(.cream300)
                    .padding(.bottom, 26)

                lossDisplay
                    .scaleEffect(showAmount ? 1 : 0.85)
                    .opacity(showAmount ? 1 : 0)
                    .overlay(
                        ZStack {
                            ChipPileSlideView(destination: .opponent)
                            WinnerSideGlow(won: false)
                        }
                        .allowsHitTesting(false)
                    )

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
                    Color.claret.opacity(0.18),
                    .clear,
                ]),
                center: UnitPoint(x: 0.5, y: 0.3),
                startRadius: 0,
                endRadius: 320
            )
        }
        .ignoresSafeArea()
    }

    private var lossDisplay: some View {
        VStack(spacing: 6) {
            Text("LOST")
                .font(.system(size: 10, weight: .medium))
                .tracking(2)
                .foregroundColor(.cream300)

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("−")
                    .font(.custom("Georgia", size: isBigLoss ? 44 : 36))
                    .foregroundColor(.claret)
                Text("\(lostAmount)")
                    .font(.custom("Georgia", size: isBigLoss ? 60 : 50))
                    .foregroundColor(.claret)
            }
            .shadow(color: Color.claret.opacity(0.25), radius: 14)
        }
    }

    private var detailCard: some View {
        VStack(spacing: 0) {
            detailRow(label: "Your hand") {
                HStack(spacing: 3) {
                    if hand.myHole.isEmpty {
                        // Should only happen for legacy hands pre-fix S1.
                        MuckPlaceholderView(size: .small)
                        MuckPlaceholderView(size: .small)
                    } else {
                        ForEach(hand.myHole, id: \.self) { card in
                            PlayingCardView(card: card, size: .small)
                        }
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
            detailRow(label: "Folded on") {
                Text(foldStreet.capitalized)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.claret)
            }
        }
        .padding(16)
        .background(Color.black.opacity(0.3))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.claret.opacity(0.22), lineWidth: 1)
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
            .fill(Color.claret.opacity(0.1))
            .frame(height: 1)
    }

    private var continueButton: some View {
        Button {
            CompletedHandHaptics.dismissImpact()
            onContinue()
        } label: {
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

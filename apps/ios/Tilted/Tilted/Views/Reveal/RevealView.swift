import SwiftUI

struct RevealView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let match: MatchState
    let round: RoundView
    @State private var revealIndex = 0
    @State private var showSummary = false

    private var awaitingRunoutHands: [HandView] {
        round.hands.filter { $0.status == "awaiting_runout" }
    }

    private var completedHands: [HandView] {
        round.hands.filter { $0.status == "complete" }
    }

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            if showSummary {
                roundSummary
            } else if revealIndex < awaitingRunoutHands.count {
                handReveal(hand: awaitingRunoutHands[revealIndex])
            } else {
                // All reveals done, show summary
                roundSummary
                    .onAppear { showSummary = true }
            }
        }
    }

    private func handReveal(hand: HandView) -> some View {
        VStack(spacing: Spacing.lg) {
            Spacer()

            Text("HAND \(hand.handIndex + 1) REVEAL")
                .font(.eyebrow)
                .tracking(2)
                .foregroundColor(.gold500)

            // Hole cards
            HStack(spacing: 20) {
                VStack(spacing: 4) {
                    Text("You")
                        .font(.caption)
                        .foregroundColor(.cream300)
                    HStack(spacing: 4) {
                        ForEach(hand.myHole, id: \.self) { card in
                            PlayingCardView(card: card, size: .large)
                        }
                    }
                }

                Text("vs")
                    .font(.bodySecondary)
                    .foregroundColor(.cream300)

                VStack(spacing: 4) {
                    Text(match.opponent.displayName.components(separatedBy: " ").first ?? "Opp")
                        .font(.caption)
                        .foregroundColor(.cream300)
                    HStack(spacing: 4) {
                        if let oppHole = hand.opponentHole {
                            ForEach(oppHole, id: \.self) { card in
                                PlayingCardView(card: card, size: .large)
                            }
                        } else {
                            CardBackView(size: .large)
                            CardBackView(size: .large)
                        }
                    }
                }
            }

            // Board
            HStack(spacing: 6) {
                ForEach(hand.board, id: \.self) { card in
                    PlayingCardView(card: card, size: .large)
                        .transition(.scale.combined(with: .opacity))
                }
            }

            // Pot
            Text("Pot: \(hand.pot)")
                .font(.chipValue)
                .fontDesign(.serif)
                .foregroundColor(.cream100)

            Spacer()

            Button("Next") {
                withAnimation(.easeInOut(duration: 0.5)) {
                    revealIndex += 1
                }
            }
            .buttonStyle(.primary)
            .padding(.horizontal, 40)
            .padding(.bottom, 32)
        }
        .padding(.horizontal, 18)
    }

    private var roundSummary: some View {
        VStack(spacing: Spacing.lg) {
            Spacer()

            Text("ROUND \(round.roundIndex) COMPLETE")
                .font(.eyebrow)
                .tracking(2)
                .foregroundColor(.gold500)

            // Net result
            let wonCount = round.hands.filter { $0.winnerUserId == store.currentUserId }.count
            let lostCount = round.hands.filter {
                $0.winnerUserId != nil && $0.winnerUserId != store.currentUserId
            }.count

            Text("Won \(wonCount) \u{00B7} Lost \(lostCount)")
                .font(.displayMedium)
                .fontDesign(.serif)
                .foregroundColor(.cream100)

            // Stack summary
            VStack(spacing: 4) {
                Text("Your stack: \(match.myTotal)")
                    .font(.bodyPrimary)
                    .foregroundColor(.cream100)
                Text("Opponent: \(match.opponentTotal)")
                    .font(.bodySecondary)
                    .foregroundColor(.cream300)
            }

            Spacer()

            Button("Next round") {
                Task {
                    await store.advanceRound(roundId: round.roundId)
                    dismiss()
                }
            }
            .buttonStyle(.primary)
            .padding(.horizontal, 40)
            .padding(.bottom, 32)
        }
        .padding(.horizontal, 18)
    }
}

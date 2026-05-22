import SwiftUI

/// Full-screen Completed Hand surface for a group of identical preflop
/// folds. Renders the count, per-hand chip loss, and total — single
/// dismiss button acknowledges every hand in the group.
struct GroupedFoldsView: View {
    let hands: [HandView]
    let match: MatchState
    let onContinue: () -> Void

    private var perHandLoss: Int {
        // All hands in a group share the same chip loss by construction.
        if let n = hands.first?.myResolvedNet { return -n }
        if let c = hands.first?.myContribution { return c }
        return 0
    }

    private var totalLoss: Int { perHandLoss * hands.count }

    private var opponentName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent"
    }

    var body: some View {
        ZStack {
            // Same background palette as HandFoldedView.
            ZStack {
                RadialGradient(
                    gradient: Gradient(colors: [.felt500, .felt700, .felt800]),
                    center: .top, startRadius: 0, endRadius: 600
                )
                RadialGradient(
                    gradient: Gradient(colors: [Color.claret.opacity(0.18), .clear]),
                    center: UnitPoint(x: 0.5, y: 0.3),
                    startRadius: 0, endRadius: 320
                )
            }
            .ignoresSafeArea()

            VStack(spacing: 0) {
                MatchHeaderBar(
                    myAvailable: match.myAvailable,
                    opponentName: opponentName,
                    opponentAvailable: match.opponentAvailable
                )

                Spacer()

                Text("\(hands.count) HANDS · FOLDED PREFLOP")
                    .font(.system(size: 10, weight: .medium))
                    .tracking(3)
                    .foregroundColor(.claret)
                    .padding(.bottom, 10)

                Text("Cleared in one wave.")
                    .font(.custom("Georgia", size: 32))
                    .foregroundColor(.cream100)
                    .padding(.bottom, 4)

                Text("Each cost \(perHandLoss) chips to the blinds — total \(totalLoss).")
                    .font(.system(size: 13))
                    .foregroundColor(.cream300)
                    .padding(.bottom, 26)

                lossDisplay

                handsList
                    .padding(.horizontal, 28)
                    .padding(.top, 24)

                Spacer()

                continueButton
                    .padding(.horizontal, 28)
                    .padding(.bottom, 32)
            }
        }
    }

    private var lossDisplay: some View {
        VStack(spacing: 6) {
            Text("LOST TOTAL")
                .font(.system(size: 10, weight: .medium))
                .tracking(2)
                .foregroundColor(.cream300)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("−")
                    .font(.custom("Georgia", size: 36))
                    .foregroundColor(.claret)
                Text("\(totalLoss)")
                    .font(.custom("Georgia", size: 50))
                    .foregroundColor(.claret)
            }
            .shadow(color: Color.claret.opacity(0.25), radius: 14)
        }
    }

    private var handsList: some View {
        VStack(spacing: 6) {
            ForEach(hands) { hand in
                HStack {
                    Text("H\(hand.handIndex + 1)")
                        .font(.custom("Georgia", size: 12).bold())
                        .foregroundColor(.cream200)
                        .frame(width: 36, alignment: .leading)
                    if !hand.myHole.isEmpty {
                        HStack(spacing: 2) {
                            ForEach(hand.myHole, id: \.self) { c in
                                PlayingCardView(card: c, size: .small)
                            }
                        }
                    }
                    Spacer()
                    Text("−\(perHandLoss)")
                        .font(.custom("Georgia", size: 12).bold())
                        .foregroundColor(.claret)
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 12)
                .background(Color.black.opacity(0.25))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.claret.opacity(0.2), lineWidth: 1)
                )
                .cornerRadius(10)
            }
        }
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

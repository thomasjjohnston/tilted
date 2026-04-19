import SwiftUI

struct CoinFlipView: View {
    let match: MatchState
    let onContinue: () -> Void

    private var isSB: Bool {
        match.currentRound?.myRole == "sb"
    }

    private var opponentName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent"
    }

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                Text("NEW MATCH")
                    .font(.system(size: 10, weight: .medium))
                    .tracking(2)
                    .foregroundColor(.gold500)

                Spacer().frame(height: 8)

                Text("Match vs \(match.opponent.displayName)")
                    .font(.custom("Georgia", size: 26))
                    .foregroundColor(.cream100)
                    .multilineTextAlignment(.center)

                Spacer().frame(height: 32)

                // Coin flip result
                VStack(spacing: 8) {
                    Text("You are")
                        .font(.system(size: 16))
                        .foregroundColor(.cream200)

                    Text(isSB ? "Small Blind" : "Big Blind")
                        .font(.custom("Georgia", size: 32))
                        .foregroundColor(.gold500)

                    Text(isSB ? "You act first this round" : "\(opponentName) acts first this round")
                        .font(.system(size: 13))
                        .foregroundColor(.cream300)
                }

                Spacer().frame(height: 32)

                // Explanation
                Text("Position flips each round. SB acts first preflop. BB acts first on flop, turn, and river.")
                    .font(.system(size: 12))
                    .foregroundColor(.cream300)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 280)

                Spacer()

                Button("Deal the cards \u{2192}") { onContinue() }
                    .buttonStyle(.primary)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)
            }
        }
    }
}

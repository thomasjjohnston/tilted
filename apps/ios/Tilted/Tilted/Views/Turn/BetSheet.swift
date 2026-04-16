import SwiftUI

struct BetSheet: View {
    let hand: HandView
    let match: MatchState
    let onSubmit: (Int, String) -> Void

    @State private var betAmount: Double = 10
    @State private var legalActions: LegalActionsResponse?
    @Environment(\.dismiss) private var dismiss

    private var minBet: Int { legalActions?.minRaise ?? 10 }
    private var maxBet: Int { legalActions?.maxBet ?? match.myAvailable }
    private var isFacingBet: Bool { hand.opponentReserved > hand.myReserved }
    private var actionLabel: String { isFacingBet ? "Raise" : "Bet" }
    private var actionType: String { isFacingBet ? "raise" : "bet" }

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            VStack(spacing: Spacing.lg) {
                // Handle
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.cream100.opacity(0.35))
                    .frame(width: 36, height: 4)

                Text("\(actionLabel.uppercased()) \u{2014} HAND \(hand.handIndex + 1)")
                    .font(.eyebrow)
                    .tracking(1.5)
                    .foregroundColor(.cream300)

                // Amount display
                Text("\(Int(betAmount))")
                    .font(.custom("Georgia", size: 44))
                    .foregroundColor(.gold500)
                    .fontDesign(.serif)
                    .contentTransition(.numericText())

                // Quick buttons
                HStack(spacing: 8) {
                    quickButton(label: "\u{00BD} Pot", amount: hand.pot / 2)
                    quickButton(label: "\u{2154} Pot", amount: hand.pot * 2 / 3)
                    quickButton(label: "Pot", amount: hand.pot)
                }

                // Slider
                HStack {
                    Text("\(minBet)")
                        .font(.caption)
                        .foregroundColor(.cream300)

                    Slider(
                        value: $betAmount,
                        in: Double(minBet)...Double(maxBet),
                        step: 1
                    )
                    .tint(.gold500)

                    Text("\(maxBet)")
                        .font(.caption)
                        .foregroundColor(.cream300)
                }

                // +/- buttons
                HStack(spacing: 16) {
                    Button {
                        betAmount = max(Double(minBet), betAmount - 10)
                    } label: {
                        Image(systemName: "minus.circle")
                            .font(.system(size: 28))
                            .foregroundColor(.cream200)
                    }

                    Button {
                        betAmount = min(Double(maxBet), betAmount + 10)
                    } label: {
                        Image(systemName: "plus.circle")
                            .font(.system(size: 28))
                            .foregroundColor(.cream200)
                    }
                }

                // After-bet readout
                Text("After this \(actionLabel.lowercased()), you will have \(match.myAvailable - Int(betAmount)) available")
                    .font(.caption)
                    .foregroundColor(.cream300)
                    .multilineTextAlignment(.center)

                // Submit
                Button("\(actionLabel) \(Int(betAmount))") {
                    onSubmit(Int(betAmount), actionType)
                }
                .buttonStyle(.primary)
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 32)
        }
        .task {
            do {
                legalActions = try await APIClient.shared.getLegalActions(handId: hand.handId)
                if let la = legalActions {
                    betAmount = Double(la.minRaise)
                }
            } catch {
                // Use defaults
            }
        }
    }

    private func quickButton(label: String, amount: Int) -> some View {
        let clamped = max(minBet, min(amount, maxBet))
        return Button {
            withAnimation(.snappy) {
                betAmount = Double(clamped)
            }
        } label: {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.cream100)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.black.opacity(0.25))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.gold500.opacity(0.25), lineWidth: 1)
                )
                .cornerRadius(8)
        }
    }
}

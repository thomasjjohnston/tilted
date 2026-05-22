import SwiftUI

/// Sheet that lets the user voluntarily reveal one or both of their
/// hole cards to the opponent. Both cards start face-down; tap to
/// flip face-up, tap again to mute. Confirm with "Reveal {N} cards".
///
/// The picker is pure UI — it doesn't hit the network. The caller
/// receives the chosen `indices` via `onSubmit` and is responsible for
/// firing `APIClient.showCards`.
struct ShowCardsPickerView: View {
    let myHole: [String]
    let opponentName: String
    let onSubmit: ([Int]) -> Void
    let onCancel: () -> Void

    /// Indices already shown (server side) — read-only previews them
    /// face-up. The user can add more but can't unshown what's already
    /// committed.
    let alreadyShown: Set<Int>

    @State private var picked: Set<Int> = []

    private var allRevealed: Set<Int> { picked.union(alreadyShown) }

    private var pickedCount: Int { picked.count }

    var body: some View {
        ZStack {
            Color.felt900.opacity(0.95).ignoresSafeArea()

            VStack(spacing: 0) {
                Text("SHOW CARDS")
                    .font(.system(size: 10, weight: .medium))
                    .tracking(3)
                    .foregroundColor(.gold500)
                    .padding(.top, 24)

                Text("Reveal to \(opponentName)")
                    .font(.custom("Georgia", size: 22))
                    .foregroundColor(.cream100)
                    .padding(.top, 6)

                Text("Tap a card to flip it face-up.")
                    .font(.system(size: 12))
                    .foregroundColor(.cream300)
                    .padding(.top, 4)

                Spacer()

                HStack(spacing: 16) {
                    cardSlot(index: 0)
                    cardSlot(index: 1)
                }

                Spacer()

                Button(action: { onSubmit(Array(picked).sorted()) }) {
                    Text(pickedCount == 0 ? "Reveal (0 cards)" : "Reveal \(pickedCount) card\(pickedCount == 1 ? "" : "s")")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(pickedCount == 0 ? .cream400 : .felt800)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(
                            pickedCount == 0
                                ? AnyView(Color.black.opacity(0.25))
                                : AnyView(LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom))
                        )
                        .cornerRadius(12)
                }
                .disabled(pickedCount == 0)
                .padding(.horizontal, 28)
                .padding(.bottom, 8)

                Button(action: onCancel) {
                    Text("Cancel")
                        .font(.system(size: 13))
                        .foregroundColor(.cream300)
                        .padding(.vertical, 10)
                }
                .padding(.bottom, 32)
            }
        }
    }

    @ViewBuilder
    private func cardSlot(index: Int) -> some View {
        let card = myHole.indices.contains(index) ? myHole[index] : ""
        let isAlreadyShown = alreadyShown.contains(index)
        let isPicked = picked.contains(index)
        let isFaceUp = isAlreadyShown || isPicked

        Button {
            // Already-shown cards can't be un-toggled.
            if isAlreadyShown { return }
            if picked.contains(index) { picked.remove(index) }
            else { picked.insert(index) }
        } label: {
            ZStack {
                if isFaceUp {
                    PlayingCardView(card: card, size: .xlarge)
                } else {
                    CardBackView(size: .xlarge)
                }
                if isAlreadyShown {
                    // "Locked" indicator — already committed via prior show.
                    Image(systemName: "lock.fill")
                        .font(.system(size: 12))
                        .foregroundColor(.gold500)
                        .padding(4)
                        .background(Color.black.opacity(0.5))
                        .clipShape(Circle())
                        .offset(x: 24, y: -32)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isFaceUp ? "Card revealed: \(card)" : "Tap to reveal card")
    }
}

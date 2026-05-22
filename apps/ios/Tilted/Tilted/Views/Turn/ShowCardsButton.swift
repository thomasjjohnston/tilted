import SwiftUI

/// Capsule button that presents `ShowCardsPickerView`, calls the show
/// endpoint, and shows a brief toast on success. Hidden if the user
/// has already shown both cards.
struct ShowCardsButton: View {
    let handId: String
    let myHole: [String]
    let initialShownIndices: [Int]
    let opponentName: String
    /// Callback fired with the updated HandDetail after server confirms.
    var onShown: ((HandDetail) -> Void)? = nil

    init(handId: String, myHole: [String], initialShownIndices: [Int], opponentName: String, onShown: ((HandDetail) -> Void)? = nil) {
        self.handId = handId
        self.myHole = myHole
        self.initialShownIndices = initialShownIndices
        self.opponentName = opponentName
        self.onShown = onShown
        self._localShownIndices = State(initialValue: Set(initialShownIndices))
    }

    /// Convenience init when you have a HandView in hand (the typical
    /// in-turn completion-screen case).
    init(hand: HandView, opponentName: String, onShown: ((HandDetail) -> Void)? = nil) {
        self.init(
            handId: hand.handId,
            myHole: hand.myHole,
            initialShownIndices: hand.myShownIndices ?? [],
            opponentName: opponentName,
            onShown: onShown
        )
    }

    @State private var showPicker = false
    @State private var toast: String?
    @State private var inflight = false
    /// Locally-tracked already-shown set so the button updates after a
    /// successful submission without waiting for the parent to push
    /// a refreshed model.
    @State private var localShownIndices: Set<Int> = []

    private var alreadyShown: Set<Int> { localShownIndices }
    private var bothShown: Bool { alreadyShown.count >= 2 }

    var body: some View {
        if bothShown {
            // Subtle indicator that you've already shown everything.
            HStack(spacing: 4) {
                Image(systemName: "eye.fill").font(.system(size: 10))
                Text("Both shown").font(.system(size: 11, weight: .semibold))
            }
            .foregroundColor(.gold500)
        } else {
            Button { showPicker = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "eye").font(.system(size: 11))
                    Text(alreadyShown.isEmpty ? "Show cards" : "Show another")
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundColor(.felt800)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(
                    LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom)
                )
                .clipShape(Capsule())
            }
            .disabled(inflight)
            .opacity(inflight ? 0.5 : 1)
            .sheet(isPresented: $showPicker) {
                ShowCardsPickerView(
                    myHole: myHole,
                    opponentName: opponentName,
                    onSubmit: { indices in
                        showPicker = false
                        Task { await submit(indices: indices) }
                    },
                    onCancel: { showPicker = false },
                    alreadyShown: alreadyShown
                )
            }
            .overlay(alignment: .top) {
                if let toast {
                    Text(toast)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.felt800)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom)
                        )
                        .clipShape(Capsule())
                        .offset(y: -40)
                        .task(id: toast) {
                            try? await Task.sleep(nanoseconds: 1_800_000_000)
                            await MainActor.run {
                                withAnimation { self.toast = nil }
                            }
                        }
                }
            }
        }
    }

    @MainActor
    private func submit(indices: [Int]) async {
        guard !indices.isEmpty else { return }
        inflight = true
        defer { inflight = false }
        do {
            let detail = try await APIClient.shared.showCards(handId: handId, indices: indices)
            // Merge into local already-shown set so the UI updates
            // immediately without needing a refresh.
            for i in indices { localShownIndices.insert(i) }
            withAnimation { toast = "Shared with \(opponentName)" }
            onShown?(detail)
        } catch {
            withAnimation { toast = "Couldn't share — try again" }
        }
    }
}

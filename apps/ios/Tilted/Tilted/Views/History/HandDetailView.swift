import SwiftUI

struct HandDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let handId: String
    @State private var detail: HandDetail?
    @State private var isLoading = true
    @State private var isFavorited = false
    @State private var scrubberIndex = 0

    var body: some View {
        NavigationStack {
            ZStack {
                Color.clear.feltBackground().ignoresSafeArea()

                if isLoading {
                    ProgressView()
                        .tint(.gold500)
                } else if let detail {
                    replayContent(detail: detail)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .foregroundColor(.cream200)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("Hand Replay")
                        .font(.displaySmall)
                        .fontDesign(.serif)
                        .foregroundColor(.cream100)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        isFavorited.toggle()
                        Task { await store.toggleFavorite(handId: handId, favorite: isFavorited) }
                    } label: {
                        Image(systemName: isFavorited ? "star.fill" : "star")
                            .foregroundColor(.gold500)
                    }
                }
            }
            .task {
                do {
                    detail = try await APIClient.shared.getHandDetail(handId: handId)
                    isFavorited = detail?.isFavorited ?? false
                } catch {
                    store.error = error.localizedDescription
                }
                isLoading = false
            }
        }
    }

    private func replayContent(detail: HandDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                // Header
                Text("ROUND \(detail.roundIndex) \u{00B7} HAND \(detail.handIndex + 1)")
                    .font(.eyebrow)
                    .tracking(1.5)
                    .foregroundColor(.cream300)

                // Hole cards
                HStack(spacing: 20) {
                    VStack(spacing: 4) {
                        Text("You")
                            .font(.caption)
                            .foregroundColor(.cream300)
                        HStack(spacing: 4) {
                            ForEach(detail.myHole, id: \.self) { card in
                                PlayingCardView(card: card, size: .large)
                            }
                        }
                    }

                    if let oppHole = detail.opponentHole {
                        VStack(spacing: 4) {
                            Text("Opponent")
                                .font(.caption)
                                .foregroundColor(.cream300)
                            HStack(spacing: 4) {
                                ForEach(oppHole, id: \.self) { card in
                                    PlayingCardView(card: card, size: .large)
                                }
                            }
                        }
                    }
                }

                // Board
                HStack(spacing: 6) {
                    ForEach(detail.board, id: \.self) { card in
                        PlayingCardView(card: card)
                    }
                }

                // Result
                HStack {
                    Text("Pot: \(detail.pot)")
                        .font(.chipValue)
                        .fontDesign(.serif)
                        .foregroundColor(.cream100)

                    Spacer()

                    if let reason = detail.terminalReason {
                        Text(reason.uppercased())
                            .font(.eyebrow)
                            .tracking(1)
                            .foregroundColor(reason == "fold" ? .claret : .gold500)
                    }
                }

                // Scrubber
                if detail.actions.count > 1 {
                    VStack(spacing: 4) {
                        Slider(
                            value: Binding(
                                get: { Double(scrubberIndex) },
                                set: { scrubberIndex = Int($0) }
                            ),
                            in: 0...Double(detail.actions.count - 1),
                            step: 1
                        )
                        .tint(.gold500)

                        Text("Action \(scrubberIndex + 1) of \(detail.actions.count)")
                            .font(.caption)
                            .foregroundColor(.cream300)
                    }
                }

                // Action log
                dividerLine

                ForEach(Array(detail.actions.enumerated()), id: \.element.id) { index, action in
                    if index > 0 && action.street != detail.actions[index - 1].street {
                        // Street separator
                        HStack {
                            Rectangle()
                                .fill(Color.gold500.opacity(0.3))
                                .frame(height: 1)
                            Text(action.street.uppercased())
                                .font(.eyebrow)
                                .tracking(1)
                                .foregroundColor(.gold500)
                            Rectangle()
                                .fill(Color.gold500.opacity(0.3))
                                .frame(height: 1)
                        }
                    }

                    actionRow(action: action, isHighlighted: index <= scrubberIndex)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
        }
    }

    private func actionRow(action: ActionDetail, isHighlighted: Bool) -> some View {
        HStack {
            Text(action.actingUserId == store.currentUserId ? "You" : "Opp")
                .font(.bodySecondary)
                .foregroundColor(.cream300)
                .frame(width: 30, alignment: .leading)

            Text(action.actionType.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(.bodySecondary)
                .foregroundColor(isHighlighted ? .cream100 : .cream300)

            if action.amount > 0 {
                Text("\(action.amount)")
                    .font(.bodySecondary)
                    .foregroundColor(.gold500)
            }

            Spacer()

            Text("Pot: \(action.potAfter)")
                .font(.caption)
                .foregroundColor(.cream300)
        }
        .padding(.vertical, 4)
        .opacity(isHighlighted ? 1 : 0.5)
    }

    private var dividerLine: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [.clear, .gold600, .clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .frame(height: 1)
            .opacity(0.7)
    }
}

import SwiftUI

struct HistoryView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var filter: HistoryFilter = .all
    @State private var resultFilter: ResultFilter = .all
    @State private var hands: [HistoryHand] = []
    @State private var isLoading = false
    @State private var selectedHandId: String?

    enum HistoryFilter: String, CaseIterable {
        case all = "All"
        case favorites = "Favorites"
    }

    enum ResultFilter: String, CaseIterable {
        case all = "All"
        case won = "Won"
        case lost = "Lost"
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.clear.feltBackground().ignoresSafeArea()

                VStack(spacing: 0) {
                    // Filter pills
                    VStack(spacing: 8) {
                        segmentedControl(
                            options: HistoryFilter.allCases.map(\.rawValue),
                            selected: filter.rawValue,
                            onSelect: { filter = HistoryFilter(rawValue: $0) ?? .all }
                        )

                        segmentedControl(
                            options: ResultFilter.allCases.map(\.rawValue),
                            selected: resultFilter.rawValue,
                            onSelect: { resultFilter = ResultFilter(rawValue: $0) ?? .all }
                        )
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)

                    // Hand list
                    if isLoading && hands.isEmpty {
                        Spacer()
                        ProgressView()
                            .tint(.gold500)
                        Spacer()
                    } else if hands.isEmpty {
                        Spacer()
                        Text("No hands yet.")
                            .font(.bodySecondary)
                            .foregroundColor(.cream300)
                        Spacer()
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 8) {
                                ForEach(hands) { hand in
                                    HandSummaryCard(hand: hand) {
                                        selectedHandId = hand.handId
                                    }
                                }
                            }
                            .padding(.horizontal, 18)
                            .padding(.bottom, 40)
                        }
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "chevron.left")
                            .foregroundColor(.cream200)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("History")
                        .font(.displaySmall)
                        .fontDesign(.serif)
                        .foregroundColor(.cream100)
                }
            }
            .sheet(item: Binding(
                get: { selectedHandId.map { IdentifiableString(value: $0) } },
                set: { selectedHandId = $0?.value }
            )) { item in
                HandDetailView(handId: item.value)
                    .environment(store)
            }
            .task { await loadHistory() }
            .onChange(of: filter) { _, _ in Task { await loadHistory() } }
            .onChange(of: resultFilter) { _, _ in Task { await loadHistory() } }
        }
    }

    private func loadHistory() async {
        isLoading = true
        do {
            let response = try await APIClient.shared.getHistory(
                favorites: filter == .favorites,
                result: resultFilter.rawValue.lowercased()
            )
            hands = response.hands
        } catch {
            store.error = error.localizedDescription
        }
        isLoading = false
    }

    private func segmentedControl(options: [String], selected: String, onSelect: @escaping (String) -> Void) -> some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { option in
                Button {
                    onSelect(option)
                } label: {
                    Text(option)
                        .font(.system(size: 12, weight: option == selected ? .semibold : .regular))
                        .foregroundColor(option == selected ? .gold500 : .cream300)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background(option == selected ? Color.gold500.opacity(0.2) : .clear)
                        .cornerRadius(7)
                }
            }
        }
        .padding(3)
        .background(Color.black.opacity(0.3))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.gold500.opacity(0.2), lineWidth: 1)
        )
        .cornerRadius(10)
    }
}

// MARK: - Hand Summary Card

struct HandSummaryCard: View {
    let hand: HistoryHand
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 8) {
                // Header
                HStack {
                    Text("R\(hand.roundIndex) \u{00B7} H\(hand.handIndex + 1)")
                        .font(.eyebrow)
                        .tracking(1)
                        .foregroundColor(.cream300)

                    Spacer()

                    if hand.isFavorited {
                        Image(systemName: "star.fill")
                            .font(.system(size: 12))
                            .foregroundColor(.gold500)
                    }

                    Text(hand.terminalReason == "fold" ? "FOLD" : "SHOWDOWN")
                        .font(.eyebrow)
                        .tracking(1)
                        .foregroundColor(hand.terminalReason == "fold" ? .cream300 : .gold500)
                }

                // Cards
                HStack(spacing: 4) {
                    ForEach(hand.myHole, id: \.self) { card in
                        PlayingCardView(card: card, size: .small)
                    }

                    if hand.terminalReason == "showdown", let oppHole = hand.opponentHole {
                        Text("vs")
                            .font(.caption)
                            .foregroundColor(.cream300)
                        ForEach(oppHole, id: \.self) { card in
                            PlayingCardView(card: card, size: .small)
                        }
                    }

                    Spacer()

                    // Board
                    ForEach(hand.board, id: \.self) { card in
                        PlayingCardView(card: card, size: .small)
                    }
                }

                // Result
                HStack {
                    Text("Pot: \(hand.pot)")
                        .font(.bodySecondary)
                        .foregroundColor(.cream100)

                    Spacer()

                    if hand.winnerUserId != nil {
                        Text(hand.winnerUserId == nil ? "Split" : "Won \(hand.pot)")
                            .font(.bodySecondary)
                            .foregroundColor(.gold500)
                    }
                }
            }
            .padding(12)
            .background(
                LinearGradient(
                    colors: [Color.white.opacity(0.04), Color.black.opacity(0.2)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(Color.gold500.opacity(0.22), lineWidth: 1)
            )
            .cornerRadius(14)
        }
    }
}

// MARK: - Helper

struct IdentifiableString: Identifiable {
    let value: String
    var id: String { value }
}

import SwiftUI

struct HomeView: View {
    @Environment(AppStore.self) private var store
    @State private var showCoinFlip = false
    @State private var showOpponentPicker = false
    @State private var revealMatch: MatchState?
    @State private var revealRound: RoundView?

    /// Active matches the current user is in — drives the list view.
    private var activeMatches: [MatchState] {
        store.matches.filter { $0.status == "active" }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.clear.feltBackground()

                if !store.hasInitiallyLoaded {
                    VStack {
                        Spacer()
                        ProgressView().tint(.gold500)
                        Spacer()
                    }
                } else if activeMatches.isEmpty {
                    noMatchesView
                } else {
                    ScrollView {
                        VStack(spacing: Spacing.md) {
                            ForEach(activeMatches, id: \.matchId) { match in
                                MatchRowCard(match: match) {
                                    openMatch(match)
                                }
                            }
                            startMatchButton
                                .padding(.top, Spacing.md)
                        }
                        .padding(.horizontal, 18)
                        .padding(.top, 16)
                        .padding(.bottom, 32)
                    }
                    .refreshable { await store.refresh() }
                }
            }
            .ignoresSafeArea(edges: .bottom)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Tilted")
                        .font(.eyebrow)
                        .tracking(1.5)
                        .foregroundColor(.cream300)
                }
            }
            .sheet(isPresented: $showOpponentPicker) {
                OpponentPickerSheet { match in
                    store.matchState = match
                    showOpponentPicker = false
                    showCoinFlip = true
                }
                .environment(store)
            }
            .fullScreenCover(isPresented: showTurn) {
                if let match = store.matchState, let round = match.currentRound {
                    TurnView(match: match, round: round)
                        .environment(store)
                }
            }
            .fullScreenCover(isPresented: Binding(
                get: { revealMatch != nil },
                set: { if !$0 { revealMatch = nil; revealRound = nil; store.activeScreen = .home } }
            )) {
                if let m = revealMatch, let r = revealRound {
                    RevealView(match: m, round: r)
                        .environment(store)
                }
            }
            .fullScreenCover(isPresented: $showCoinFlip) {
                if let match = store.matchState {
                    CoinFlipView(match: match) {
                        showCoinFlip = false
                        if match.currentRound?.handsPendingMe ?? 0 > 0 {
                            store.activeScreen = .turn
                        }
                    }
                }
            }
        }
    }

    // MARK: - Bindings

    private var showTurn: Binding<Bool> {
        Binding(get: { store.activeScreen == .turn }, set: { if !$0 { store.activeScreen = .home } })
    }

    // MARK: - Actions

    private func openMatch(_ match: MatchState) {
        store.matchState = match
        if match.status == "ended" { return }

        let roundDone = match.currentRound?.handsPendingMe == 0
            && match.currentRound?.handsPendingOpponent == 0
        if match.currentRound?.status == "revealing" || roundDone {
            revealMatch = match
            revealRound = match.currentRound
        } else {
            store.activeScreen = .turn
        }
    }

    // MARK: - Subviews

    private var noMatchesView: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: Spacing.xxl)

            Text("No match\nin play.")
                .font(.displayLarge)
                .fontDesign(.serif)
                .foregroundColor(.cream100)
                .multilineTextAlignment(.center)

            Spacer().frame(height: Spacing.md)

            Text("Challenge a friend to deal ten fresh hands.")
                .font(.bodySecondary)
                .foregroundColor(.cream300)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 18)

            Spacer().frame(height: Spacing.xl)

            dividerLine.padding(.horizontal, 18)

            Spacer().frame(height: Spacing.xl)

            startMatchButton.padding(.horizontal, 18)

            Spacer()
        }
    }

    private var startMatchButton: some View {
        Button {
            showOpponentPicker = true
        } label: {
            Text("Start a match")
        }
        .buttonStyle(.primary)
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
            .padding(.vertical, 14)
    }
}

// MARK: - Match row card

struct MatchRowCard: View {
    let match: MatchState
    let onTap: () -> Void

    private var opponentInitials: String {
        String(match.opponent.displayName.prefix(2)).uppercased()
    }

    private var opponentFirst: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opp"
    }

    private var statusCopy: String {
        guard let round = match.currentRound else {
            return "Round loading…"
        }
        if round.status == "revealing" {
            return "Round \(round.roundIndex) ready to reveal"
        }
        if round.handsPendingMe > 0 {
            return "\(round.handsPendingMe) hand\(round.handsPendingMe == 1 ? "" : "s") await you"
        }
        if round.handsPendingOpponent > 0 {
            return "Waiting on \(opponentFirst) \u{00B7} \(round.handsPendingOpponent) left"
        }
        return "Round \(round.roundIndex) complete"
    }

    private var statusColor: Color {
        guard let round = match.currentRound else { return .cream300 }
        if round.handsPendingMe > 0 || round.status == "revealing" { return .gold500 }
        return .cream300
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                AvatarView(initials: opponentInitials, size: .large)

                VStack(alignment: .leading, spacing: 4) {
                    Text(match.opponent.displayName)
                        .font(.displaySmall)
                        .fontDesign(.serif)
                        .foregroundColor(.cream100)
                    Text(statusCopy)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(statusColor)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(match.myAvailable)")
                        .font(.custom("Georgia", size: 20))
                        .foregroundColor(.gold500)
                    Text("chips")
                        .font(.system(size: 9, weight: .medium))
                        .tracking(0.5)
                        .foregroundColor(.cream400)
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 13))
                    .foregroundColor(.cream300)
            }
            .padding(14)
            .background(
                LinearGradient(
                    colors: [Color.gold500.opacity(0.05), Color.black.opacity(0.2)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(Color.gold500.opacity(0.25), lineWidth: 1)
            )
            .cornerRadius(14)
        }
    }
}

#Preview {
    HomeView()
        .environment(AppStore())
}

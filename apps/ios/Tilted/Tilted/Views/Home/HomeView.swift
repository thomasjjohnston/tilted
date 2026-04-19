import SwiftUI

struct HomeView: View {
    @Environment(AppStore.self) private var store
    @State private var showCoinFlip = false
    @State private var isCreatingMatch = false
    @State private var revealMatch: MatchState?
    @State private var revealRound: RoundView?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.clear.feltBackground()

                if !store.hasInitiallyLoaded {
                    VStack {
                        Spacer()
                        ProgressView()
                            .tint(.gold500)
                        Spacer()
                    }
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            if let match = store.matchState {
                                if match.status == "ended" {
                                    matchEndedView(match: match)
                                } else if let round = match.currentRound {
                                    activeMatchView(match: match, round: round)
                                } else {
                                    noRoundView(match: match)
                                }
                            } else {
                                noMatchView
                            }
                        }
                        .padding(.horizontal, 18)
                        .padding(.top, 16)
                    }
                    .refreshable {
                        await store.refresh()
                    }
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
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        store.activeScreen = .settings
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundColor(.gold500)
                    }
                }
            }
            .sheet(isPresented: showSettings) {
                SettingsView()
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
            .fullScreenCover(isPresented: showHistory) {
                HistoryView()
                    .environment(store)
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

    // MARK: - State Bindings

    private var showSettings: Binding<Bool> {
        Binding(get: { store.activeScreen == .settings }, set: { if !$0 { store.activeScreen = .home } })
    }

    private var showTurn: Binding<Bool> {
        Binding(get: { store.activeScreen == .turn }, set: { if !$0 { store.activeScreen = .home } })
    }

    // showReveal is now driven by revealMatch/revealRound state

    private var showHistory: Binding<Bool> {
        Binding(get: { store.activeScreen == .history }, set: { if !$0 { store.activeScreen = .home } })
    }

    // MARK: - Active Match View

    private func activeMatchView(match: MatchState, round: RoundView) -> some View {
        VStack(spacing: 0) {
            // Opponent header
            HStack(spacing: 10) {
                AvatarView(initials: String(match.opponent.displayName.prefix(2)).uppercased())
                VStack(alignment: .leading, spacing: 2) {
                    Text("MATCH VS.")
                        .font(.eyebrow)
                        .tracking(1.5)
                        .foregroundColor(.cream300)
                    Text(match.opponent.displayName)
                        .font(.displaySmall)
                        .fontDesign(.serif)
                        .foregroundColor(.cream100)
                }
                Spacer()
            }

            dividerLine

            // Chip badges
            HStack(spacing: 8) {
                ChipBadgeView(
                    label: "You",
                    total: match.myTotal,
                    available: match.myAvailable,
                    reserved: match.myReserved,
                    isMe: true
                )
                ChipBadgeView(
                    label: match.opponent.displayName.components(separatedBy: " ").first ?? "Opp",
                    total: match.opponentTotal,
                    available: match.opponentAvailable,
                    reserved: match.opponentReserved
                )
            }

            Spacer().frame(height: Spacing.lg)

            // Round info
            Text("ROUND \(String(format: "%02d", round.roundIndex)) \u{00B7} YOU ARE \(round.myRole.uppercased())")
                .font(.eyebrow)
                .tracking(1.5)
                .foregroundColor(.cream300)

            Spacer().frame(height: Spacing.xs)

            // Chip bar
            let resolved = 10 - round.handsPendingMe - round.handsPendingOpponent
            ChipBarView(
                resolved: max(0, resolved),
                pendingMe: round.handsPendingMe,
                pendingOpponent: round.handsPendingOpponent,
                total: 10
            )

            Spacer().frame(height: Spacing.lg)

            // Main CTA area
            let allResolved = round.handsPendingMe == 0 && round.handsPendingOpponent == 0
            if round.status == "revealing" || allResolved {
                // Round reveal ready
                let allInCount = round.hands.filter { $0.status == "awaiting_runout" }.count

                Text("ROUND \(round.roundIndex) COMPLETE")
                    .font(.eyebrow)
                    .tracking(1.5)
                    .foregroundColor(.gold500)

                Spacer().frame(height: Spacing.sm)

                if allInCount > 0 {
                    Text("\(allInCount) all-in hand\(allInCount == 1 ? "" : "s") to reveal")
                        .font(.custom("Georgia", size: 20))
                        .foregroundColor(.cream100)
                        .multilineTextAlignment(.center)

                    Text("Cards will be dealt to determine the winner\(allInCount == 1 ? "" : "s").")
                        .font(.system(size: 12))
                        .foregroundColor(.cream300)
                        .multilineTextAlignment(.center)
                        .padding(.top, 2)
                } else {
                    Text("All hands resolved")
                        .font(.custom("Georgia", size: 20))
                        .foregroundColor(.cream100)
                }

                Spacer().frame(height: Spacing.md)

                Button(allInCount > 0 ? "Watch the reveal \u{2192}" : "See round summary \u{2192}") {
                    // Capture the current match/round BEFORE advancing
                    // so RevealView has stable data that won't change mid-animation
                    revealMatch = store.matchState
                    revealRound = store.matchState?.currentRound
                }
                .buttonStyle(.primary)
            } else if round.handsPendingMe > 0 {
                // Your turn
                let count = round.handsPendingMe
                Text("\(numberWord(count)) hand\(count == 1 ? "" : "s")")
                    .font(.displayMedium)
                    .fontDesign(.serif)
                    .foregroundColor(.cream100)
                +
                Text("\nawait your action.")
                    .font(.displayMedium)
                    .fontDesign(.serif)
                    .foregroundColor(.gold500)

                Spacer().frame(height: Spacing.lg)

                Button("Take your turn") {
                    store.activeScreen = .turn
                }
                .buttonStyle(.primary)
            } else {
                // Waiting on opponent
                VStack(spacing: Spacing.sm) {
                    Text("\u{23F3}")
                        .font(.system(size: 36))
                        .foregroundColor(.cream300)

                    Text("Turn sent.")
                        .font(.displaySmall)
                        .fontDesign(.serif)
                        .foregroundColor(.cream100)

                    Text("\(match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent") has \(round.handsPendingOpponent) hand\(round.handsPendingOpponent == 1 ? "" : "s") to answer.")
                        .font(.caption)
                        .foregroundColor(.cream300)
                }
                .padding(18)
                .frame(maxWidth: .infinity)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.gold500.opacity(0.2), lineWidth: 1)
                )
            }

            Spacer().frame(height: Spacing.sm)

            Button("History \u{00B7} Favorites") {
                store.activeScreen = .history
            }
            .buttonStyle(.ghost)
        }
    }

    // MARK: - No Match View

    private var noMatchView: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: Spacing.xxl)

            Text("No match\nin play.")
                .font(.displayLarge)
                .fontDesign(.serif)
                .foregroundColor(.cream100)
                .multilineTextAlignment(.center)

            Spacer().frame(height: Spacing.md)

            Text("Start a new match to deal ten fresh hands.")
                .font(.bodySecondary)
                .foregroundColor(.cream300)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 10)

            Spacer().frame(height: Spacing.xl)

            dividerLine

            Spacer().frame(height: Spacing.xl)

            Button {
                Task { await createMatch() }
            } label: {
                if isCreatingMatch {
                    HStack(spacing: 8) {
                        ProgressView().tint(.felt800)
                        Text("Dealing...")
                    }
                } else {
                    Text("Start new match")
                }
            }
            .buttonStyle(.primary)
            .disabled(isCreatingMatch)

            Spacer().frame(height: Spacing.sm)

            Button("View history") {
                store.activeScreen = .history
            }
            .buttonStyle(.ghost)
        }
    }

    // MARK: - Match Ended

    private func matchEndedView(match: MatchState) -> some View {
        VStack(spacing: Spacing.lg) {
            Spacer().frame(height: Spacing.xxl)

            let iWon = match.winnerUserId == store.currentUserId
            Text(iWon ? "You won!" : "You lost.")
                .font(.displayLarge)
                .fontDesign(.serif)
                .foregroundColor(iWon ? .gold500 : .claret)

            Text("Final chips: You \(match.myAvailable) \u{2014} \(match.opponent.displayName.components(separatedBy: " ").first ?? "Opp") \(match.opponentAvailable)")
                .font(.bodySecondary)
                .foregroundColor(.cream300)

            Button {
                Task { await createMatch() }
            } label: {
                if isCreatingMatch {
                    HStack(spacing: 8) {
                        ProgressView().tint(.felt800)
                        Text("Dealing...")
                    }
                } else {
                    Text("Start new match")
                }
            }
            .buttonStyle(.primary)
            .disabled(isCreatingMatch)

            Button("View history") {
                store.activeScreen = .history
            }
            .buttonStyle(.ghost)
        }
    }

    private func noRoundView(match: MatchState) -> some View {
        VStack {
            Text("Match active, waiting for round...")
                .foregroundColor(.cream300)
        }
    }

    // MARK: - Actions

    private func createMatch() async {
        isCreatingMatch = true
        await store.startNewMatch()
        isCreatingMatch = false
        if store.matchState != nil { showCoinFlip = true }
    }

    // MARK: - Helpers

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

    private func numberWord(_ n: Int) -> String {
        let words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"]
        return n < words.count ? words[n] : "\(n)"
    }
}

#Preview {
    HomeView()
        .environment(AppStore())
}

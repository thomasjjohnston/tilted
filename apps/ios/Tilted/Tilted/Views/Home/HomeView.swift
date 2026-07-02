import SwiftUI

struct HomeView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var showCoinFlip = false
    @State private var showOpponentPicker = false
    @State private var revealMatch: MatchState?
    @State private var revealRound: RoundView?
    @State private var pingToast: String?

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
                                MatchRowCard(
                                    match: match,
                                    onTap: { openMatch(match) },
                                    onPing: { Task { await ping(match: match) } }
                                )
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

                // Ping toast — small chip at the top that auto-clears.
                if let quip = pingToast {
                    VStack {
                        HStack(spacing: 6) {
                            Image(systemName: "bell.fill")
                                .font(.system(size: 10))
                            Text(quip)
                                .font(.system(size: 12, weight: .medium))
                                .lineLimit(2)
                        }
                        .foregroundColor(.felt800)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(
                            LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom)
                        )
                        .clipShape(Capsule())
                        .shadow(color: .black.opacity(0.3), radius: 6, y: 3)
                        .padding(.top, 8)
                        .padding(.horizontal, 24)
                        Spacer()
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: quip) {
                        try? await Task.sleep(nanoseconds: 2_500_000_000)
                        await MainActor.run {
                            withAnimation(.easeInOut(duration: 0.3)) { pingToast = nil }
                        }
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
            .fullScreenCover(isPresented: showWaiting) {
                if let match = store.matchState, let round = match.currentRound {
                    WaitingDashboardView(match: match, round: round)
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
            // Safety-net refresh: catches anything the in-place splice
            // missed (e.g., opponent's actions since last app open).
            .task { await store.refresh() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await store.refresh() } }
            }
            // Retroactive Completed Hand surfacing — if any hand
            // resolved while the user wasn't actively in a turn, the
            // queue at store.unseenCompletions presents them
            // sequentially before the user can interact with home.
            .fullScreenCover(item: Binding(
                get: { store.unseenCompletions.first },
                set: { _ in }
            )) { hand in
                CompletedHandRouterView(
                    hand: hand,
                    match: matchFor(hand) ?? placeholderMatch,
                    onContinue: { store.acknowledgeCompletion(hand.handId) }
                )
                .environment(store)
            }
        }
    }

    /// Find the match containing this completed hand so the completion
    /// screen has the surrounding context (opponent name, stacks, etc).
    private func matchFor(_ hand: HandView) -> MatchState? {
        store.matches.first {
            $0.currentRound?.hands.contains { $0.handId == hand.handId } ?? false
        }
    }

    private var placeholderMatch: MatchState {
        MatchState(
            matchId: "", status: "active", winnerUserId: nil,
            opponent: Opponent(userId: "", displayName: "Opponent"),
            myTotal: 0, opponentTotal: 0,
            myReserved: 0, opponentReserved: 0,
            myAvailable: 0, opponentAvailable: 0,
            currentRound: nil
        )
    }

    // MARK: - Bindings

    // Dismissing a full-screen cover doesn't re-run HomeView's `.task` or
    // change scenePhase, so Home would otherwise show stale state after a
    // turn (beta feedback S7-1). Refresh on the way back to home.
    private var showTurn: Binding<Bool> {
        Binding(get: { store.activeScreen == .turn }, set: { if !$0 { store.activeScreen = .home; Task { await store.refresh() } } })
    }

    private var showWaiting: Binding<Bool> {
        Binding(get: { store.activeScreen == .waiting }, set: { if !$0 { store.activeScreen = .home; Task { await store.refresh() } } })
    }

    // MARK: - Actions

    @MainActor
    private func ping(match: MatchState) async {
        do {
            let resp = try await APIClient.shared.pingOpponent(matchId: match.matchId)
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                pingToast = "Sent: \"\(resp.quip)\""
            }
        } catch {
            withAnimation { pingToast = "Couldn't send ping" }
        }
    }

    private func openMatch(_ match: MatchState) {
        store.matchState = match
        if match.status == "ended" { return }

        let roundDone = match.currentRound?.handsPendingMe == 0
            && match.currentRound?.handsPendingOpponent == 0
        if match.currentRound?.status == "revealing" || roundDone {
            revealMatch = match
            revealRound = match.currentRound
        } else if (match.currentRound?.handsPendingMe ?? 0) == 0
                && (match.currentRound?.handsPendingOpponent ?? 0) > 0 {
            // No pending actions for me, opponent is acting → waiting dashboard
            store.activeScreen = .waiting
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
    var onPing: (() -> Void)? = nil

    private var opponentInitials: String {
        String(match.opponent.displayName.prefix(2)).uppercased()
    }

    private var opponentFirst: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opp"
    }

    /// True when the opponent is on action and the user is waiting — the
    /// only state where pinging makes sense.
    private var canPing: Bool {
        guard let round = match.currentRound, match.status == "active" else { return false }
        return round.handsPendingOpponent > 0 && round.handsPendingMe == 0
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
        VStack(spacing: 8) {
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

                    // Both stacks visible — never need to drill into a
                    // match to see who's ahead.
                    VStack(alignment: .trailing, spacing: 2) {
                        HStack(spacing: 6) {
                            Text("You")
                                .font(.system(size: 8, weight: .semibold))
                                .tracking(0.8)
                                .foregroundColor(.cream300)
                            Text("\(match.myAvailable)")
                                .font(.custom("Georgia", size: 18).bold())
                                .foregroundColor(.gold500)
                        }
                        HStack(spacing: 6) {
                            Text(opponentFirst)
                                .font(.system(size: 8, weight: .semibold))
                                .tracking(0.8)
                                .foregroundColor(.cream300)
                            Text("\(match.opponentAvailable)")
                                .font(.custom("Georgia", size: 14))
                                .foregroundColor(.cream100)
                        }
                    }

                    Image(systemName: "chevron.right")
                        .font(.system(size: 13))
                        .foregroundColor(.cream300)
                }
                .padding(14)
            }

            // Ping button — only visible while it's the opponent's turn.
            if canPing, let onPing {
                Button(action: onPing) {
                    HStack(spacing: 6) {
                        Image(systemName: "bell.fill")
                            .font(.system(size: 11))
                        Text("Ping \(opponentFirst)")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundColor(.felt800)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 7)
                    .background(
                        LinearGradient(
                            colors: [.gold500, .gold700],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
                    .clipShape(Capsule())
                }
                .padding(.bottom, 10)
            }
        }
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

#Preview {
    HomeView()
        .environment(AppStore())
}

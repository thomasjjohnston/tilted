import SwiftUI

struct MatchUpView: View {
    @Environment(AppStore.self) private var store
    @State private var data: MatchUpResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedHandId: IdentifiableString?
    @State private var roster: [UserRosterEntry] = []
    @AppStorage("matchup.selectedOpponentId") private var selectedOpponentId: String = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Color.clear.feltBackground().ignoresSafeArea()

                if isLoading && data == nil {
                    ProgressView().tint(.gold500)
                } else if roster.isEmpty && data == nil {
                    emptyState
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            if roster.count > 1 {
                                opponentSelector
                            }
                            if let data {
                                if data.scoreboard.handsPlayed < 10 {
                                    earlyStateBanner(data.scoreboard.handsPlayed)
                                }
                                scoreboardHero(data)
                                momentsSection(data.moments)
                                headToHeadSection(data.headToHead)
                                pinnedHandsSection(data.pinnedHands)
                            } else {
                                noHistoryForOpponent
                            }
                        }
                        .padding(.vertical, 16)
                    }
                    .refreshable { await reloadAll() }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Match-up")
                        .font(.eyebrow)
                        .tracking(1.5)
                        .foregroundColor(.cream300)
                }
            }
            .sheet(item: $selectedHandId) { item in
                HandDetailView(handId: item.value)
                    .environment(store)
            }
            .task { await reloadAll() }
            .onAppear {
                if data != nil || !roster.isEmpty {
                    Task { await reloadAll() }
                }
            }
            .onChange(of: selectedOpponentId) { _, _ in
                Task { await loadMatchup() }
            }
        }
    }

    // MARK: - Load

    private func reloadAll() async {
        isLoading = true
        errorMessage = nil
        async let loadRoster: () = loadRoster()
        async let loadMatchupInitial: () = loadMatchup()
        _ = await (loadRoster, loadMatchupInitial)
        isLoading = false
    }

    private func loadRoster() async {
        do {
            roster = try await APIClient.shared.listUsers()
            // Default selection: if we have no persisted choice, pick the
            // first roster entry. If our persisted choice no longer exists
            // (opponent deleted their account), fall back to the first.
            if selectedOpponentId.isEmpty || !roster.contains(where: { $0.userId == selectedOpponentId }) {
                selectedOpponentId = roster.first?.userId ?? ""
            }
        } catch {
            // Non-fatal — fall back to no opponent filter and let the server
            // pick most-recently-played
        }
    }

    private func loadMatchup() async {
        errorMessage = nil
        do {
            let opponentId = selectedOpponentId.isEmpty ? nil : selectedOpponentId
            data = try await APIClient.shared.getMatchUp(opponentId: opponentId)
        } catch APIError.notFound {
            data = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Opponent selector

    private var opponentSelector: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(roster) { u in
                    let selected = u.userId == selectedOpponentId
                    Button { selectedOpponentId = u.userId } label: {
                        HStack(spacing: 6) {
                            AvatarView(initials: u.initials, size: .small)
                            Text(u.displayName.components(separatedBy: " ").first ?? u.displayName)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(selected ? .felt800 : .cream200)
                        }
                        .padding(.vertical, 6)
                        .padding(.horizontal, 10)
                        .background(selected ? Color.gold500 : Color.black.opacity(0.2))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(Color.gold500.opacity(selected ? 0 : 0.3), lineWidth: 1)
                        )
                        .cornerRadius(16)
                    }
                }
            }
            .padding(.horizontal, 14)
        }
        .padding(.bottom, 10)
    }

    private var noHistoryForOpponent: some View {
        VStack(spacing: 8) {
            Text("\u{1F3B2}")
                .font(.system(size: 36))
            Text("No history yet against\n\(selectedOpponentName).")
                .font(.displaySmall)
                .fontDesign(.serif)
                .foregroundColor(.cream100)
                .multilineTextAlignment(.center)
            Text("Challenge them from Home to get started.")
                .font(.bodySecondary)
                .foregroundColor(.cream300)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .padding(.vertical, 40)
    }

    private var selectedOpponentName: String {
        roster.first(where: { $0.userId == selectedOpponentId })?.displayName ?? "your opponent"
    }

    // MARK: - Early-state banner

    private func earlyStateBanner(_ handsPlayed: Int) -> some View {
        HStack(spacing: 8) {
            Text("\u{1F331}")
            Text(handsPlayed == 0
                ? "Play a match to start building history."
                : "Play a few more hands — stats fill in as you go.")
                .font(.system(size: 11))
                .foregroundColor(.cream200)
            Spacer()
        }
        .padding(10)
        .background(Color.gold500.opacity(0.08))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.gold500.opacity(0.25), lineWidth: 1)
        )
        .cornerRadius(10)
        .padding(.horizontal, 12)
        .padding(.bottom, 12)
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: Spacing.md) {
            Text("No rivalry yet.")
                .font(.displaySmall)
                .fontDesign(.serif)
                .foregroundColor(.cream100)
            Text(errorMessage ?? "Play a match to start building history here.")
                .font(.bodySecondary)
                .foregroundColor(.cream300)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
    }

    // MARK: - Scoreboard hero

    @ViewBuilder
    private func scoreboardHero(_ data: MatchUpResponse) -> some View {
        VStack(spacing: 10) {
            Text("CAREER MATCH-UP")
                .font(.eyebrow)
                .tracking(1.5)
                .foregroundColor(.gold500)

            HStack(alignment: .center, spacing: 22) {
                scoreColumn(initials: data.you.initials, count: data.scoreboard.matchesWonYou, label: "You")
                Text("\u{2013}")
                    .font(.custom("Georgia", size: 24))
                    .foregroundColor(.cream300)
                scoreColumn(initials: data.opponent.initials, count: data.scoreboard.matchesWonOpponent, label: firstName(data.opponent.displayName))
            }
            .padding(.top, 4)

            Text(scoreboardSubtitle(data))
                .font(.system(size: 11))
                .foregroundColor(.cream300)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .padding(.horizontal, 14)
        .background(
            LinearGradient(
                colors: [Color.white.opacity(0.04), Color.black.opacity(0.2)],
                startPoint: .top, endPoint: .bottom
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.gold500.opacity(0.25), lineWidth: 1)
        )
        .cornerRadius(12)
        .padding(.horizontal, 12)
    }

    private func scoreColumn(initials: String, count: Int, label: String) -> some View {
        VStack(spacing: 6) {
            AvatarView(initials: initials, size: .large)
            Text("\(count)")
                .font(.custom("Georgia", size: 42))
                .foregroundColor(.cream100)
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .tracking(1)
                .foregroundColor(.cream300)
        }
    }

    private func scoreboardSubtitle(_ data: MatchUpResponse) -> String {
        var parts: [String] = []
        let streak = data.scoreboard.currentStreak
        if streak.count > 0 && streak.who != "none" {
            let who = streak.who == "you" ? "W" : "L"
            parts.append("\(who)\(streak.count) streak")
        }
        parts.append("\(formatCount(data.scoreboard.handsPlayed)) hands")
        if let last = data.scoreboard.lastMatchDate {
            parts.append("Last \(relativeDate(last))")
        }
        return parts.joined(separator: " \u{00B7} ")
    }

    // MARK: - Moments

    @ViewBuilder
    private func momentsSection(_ moments: [Moment]) -> some View {
        if !moments.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("\u{1F48E} MOMENTS")
                    .font(.eyebrow)
                    .tracking(1.5)
                    .foregroundColor(.cream300)

                VStack(spacing: 6) {
                    ForEach(moments.prefix(3)) { moment in
                        momentCard(moment)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 18)
        }
    }

    private func momentCard(_ moment: Moment) -> some View {
        Button {
            if let handId = moment.handId {
                selectedHandId = IdentifiableString(value: handId)
            }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                tagPill(moment.kind)
                Text(moment.copy)
                    .font(.system(size: 12))
                    .foregroundColor(.cream100)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let matchIndex = moment.matchIndex {
                    Text("M\(matchIndex)")
                        .font(.system(size: 10))
                        .foregroundColor(.cream400)
                }
            }
            .padding(10)
            .background(
                LinearGradient(
                    colors: [Color.white.opacity(0.03), Color.black.opacity(0.2)],
                    startPoint: .top, endPoint: .bottom
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.gold500.opacity(0.2), lineWidth: 1)
            )
            .cornerRadius(10)
        }
        .disabled(moment.handId == nil)
    }

    private func tagPill(_ kind: String) -> some View {
        let (label, color): (String, Color) = {
            switch kind {
            case "cooler": return ("COOLER", .gold500)
            case "biggest_pot": return ("BIG POT", .gold500)
            case "bad_beat": return ("BAD BEAT", .claret)
            case "streak_start": return ("STREAK", .cream200)
            case "milestone": return ("MILESTONE", .cream200)
            default: return (kind.uppercased(), .cream200)
            }
        }()
        return Text(label)
            .font(.system(size: 9, weight: .bold))
            .tracking(0.5)
            .foregroundColor(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(color.opacity(0.3), lineWidth: 1)
            )
            .cornerRadius(6)
    }

    // MARK: - Head-to-head

    @ViewBuilder
    private func headToHeadSection(_ h2h: HeadToHead) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\u{2694} HEAD TO HEAD")
                .font(.eyebrow)
                .tracking(1.5)
                .foregroundColor(.cream300)

            h2hBar(label: "VPIP %", me: h2h.vpipYou, opp: h2h.vpipOpponent, format: .percent)
            h2hBar(label: "Aggression", me: h2h.aggressionYou, opp: h2h.aggressionOpponent, format: .factor)
            h2hBar(label: "Showdown Win %", me: h2h.showdownWinPctYou, opp: h2h.showdownWinPctOpponent, format: .percent)
        }
        .padding(.horizontal, 14)
        .padding(.top, 18)
    }

    enum H2HFormat { case percent, factor }

    private func h2hBar(label: String, me: Double, opp: Double, format: H2HFormat) -> some View {
        VStack(spacing: 4) {
            HStack {
                Text(formatH2H(me, format))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.gold500)
                Spacer()
                Text(label.uppercased())
                    .font(.system(size: 10, weight: .medium))
                    .tracking(0.8)
                    .foregroundColor(.cream300)
                Spacer()
                Text(formatH2H(opp, format))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.cream200)
            }

            GeometryReader { geo in
                let total = max(me + opp, 0.0001)
                let myFrac = CGFloat(me / total)
                HStack(spacing: 2) {
                    Rectangle()
                        .fill(Color.gold500)
                        .frame(width: max(0, geo.size.width * myFrac - 1))
                    Rectangle()
                        .fill(Color.cream300.opacity(0.6))
                }
                .frame(height: 6)
                .cornerRadius(3)
            }
            .frame(height: 6)
        }
        .padding(10)
        .background(Color.black.opacity(0.2))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.gold500.opacity(0.15), lineWidth: 1)
        )
        .cornerRadius(10)
    }

    private func formatH2H(_ value: Double, _ format: H2HFormat) -> String {
        switch format {
        case .percent: return "\(Int(value.rounded()))%"
        case .factor: return String(format: "%.1f", value)
        }
    }

    // MARK: - Pinned hands

    @ViewBuilder
    private func pinnedHandsSection(_ pinned: [PinnedHand]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\u{1F4CC} PINNED HANDS \u{00B7} \(pinned.count)")
                .font(.eyebrow)
                .tracking(1.5)
                .foregroundColor(.cream300)

            if pinned.isEmpty {
                Text("Pin a hand from the result screen to see it here.")
                    .font(.system(size: 11))
                    .foregroundColor(.cream400)
                    .padding(.vertical, 12)
            } else {
                let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(pinned.prefix(4)) { pin in
                        pinnedCard(pin)
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 18)
        .padding(.bottom, 24)
    }

    private func pinnedCard(_ pin: PinnedHand) -> some View {
        Button {
            selectedHandId = IdentifiableString(value: pin.handId)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("M\(pin.matchIndex) H\(pin.handIndexInRound + 1)")
                        .font(.system(size: 10, weight: .medium))
                        .tracking(0.8)
                        .foregroundColor(.cream300)
                    Spacer()
                    Text("\u{1F4CC}")
                        .font(.system(size: 10))
                }
                HStack(spacing: 3) {
                    ForEach(pin.myHole, id: \.self) { c in
                        PlayingCardView(card: c, size: .small)
                    }
                }
                Text(pin.tagCopy)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(tagColor(pin.tag))
                    .lineLimit(1)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(
                    colors: [Color.white.opacity(0.03), Color.black.opacity(0.2)],
                    startPoint: .top, endPoint: .bottom
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.gold500.opacity(0.2), lineWidth: 1)
            )
            .cornerRadius(10)
        }
    }

    private func tagColor(_ tag: String) -> Color {
        switch tag {
        case "cooler", "bluff", "flush", "straight", "set", "favorite": return .gold500
        case "bad_beat": return .claret
        default: return .cream200
        }
    }

    // MARK: - Helpers

    private func firstName(_ name: String) -> String {
        name.components(separatedBy: " ").first ?? name
    }

    private func formatCount(_ n: Int) -> String {
        if n >= 1000 { return String(format: "%.1fk", Double(n) / 1000.0) }
        return "\(n)"
    }

    private func relativeDate(_ iso: String) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = fmt.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return iso }
        let interval = Date().timeIntervalSince(date)
        let hours = interval / 3600
        if hours < 24 { return "today" }
        if hours < 48 { return "yesterday" }
        let days = Int(hours / 24)
        if days < 7 { return "\(days)d ago" }
        let weeks = days / 7
        if weeks < 5 { return "\(weeks)w ago" }
        return "\(days)d ago"
    }
}

#Preview {
    MatchUpView()
        .environment(AppStore())
}

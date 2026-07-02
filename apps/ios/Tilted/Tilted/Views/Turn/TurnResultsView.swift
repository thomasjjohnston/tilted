import SwiftUI

// Grouped results for a submitted turn (beta feedback #2/#3). Instead of a
// separate full-screen moment per resolved hand, it shows:
//   • one "blinds won" screen listing every hand you won by fold,
//   • one "blinds lost" screen listing every hand you folded,
//   • then each showdown in turn, stepped with a "Next Showdown →" button.
// A single win/loss still gets its full cinematic HandWon/HandFolded moment.
struct TurnResultsView: View {
    let hands: [HandView]
    let match: MatchState
    let currentUserId: String?
    let onDone: () -> Void

    @Environment(AppStore.self) private var store
    @State private var frozen: [HandView] = []
    @State private var pageIndex = 0

    private func iWon(_ h: HandView) -> Bool {
        h.winnerUserId != nil && h.winnerUserId != match.opponent.userId
    }

    private var wonFolds: [HandView] {
        frozen.filter { $0.terminalReason == "fold" && iWon($0) }.sorted { $0.handIndex < $1.handIndex }
    }
    private var lostFolds: [HandView] {
        frozen.filter { $0.terminalReason == "fold" && !iWon($0) }.sorted { $0.handIndex < $1.handIndex }
    }
    private var showdowns: [HandView] {
        frozen.filter { $0.terminalReason != "fold" }.sorted { $0.handIndex < $1.handIndex }
    }

    private enum Page: Equatable { case wonGroup, lostGroup, showdown(Int) }

    private var pages: [Page] {
        var p: [Page] = []
        if !wonFolds.isEmpty { p.append(.wonGroup) }
        if !lostFolds.isEmpty { p.append(.lostGroup) }
        for i in showdowns.indices { p.append(.showdown(i)) }
        return p
    }

    var body: some View {
        ZStack {
            Color.felt900.ignoresSafeArea()
            content
        }
        .onAppear { if frozen.isEmpty { frozen = hands } }
    }

    @ViewBuilder
    private var content: some View {
        let ps = pages
        if ps.isEmpty {
            Color.clear.onAppear(perform: finish)
        } else {
            let idx = min(pageIndex, ps.count - 1)
            let isLast = idx == ps.count - 1
            switch ps[idx] {
            case .wonGroup:
                if wonFolds.count == 1 {
                    HandWonView(hand: wonFolds[0], match: match, onContinue: advance)
                } else {
                    FoldGroupView(hands: wonFolds, match: match, currentUserId: currentUserId,
                                  won: true, onContinue: advance)
                }
            case .lostGroup:
                if lostFolds.count == 1 {
                    HandFoldedView(hand: lostFolds[0], match: match, onContinue: advance)
                } else {
                    FoldGroupView(hands: lostFolds, match: match, currentUserId: currentUserId,
                                  won: false, onContinue: advance)
                }
            case .showdown(let i):
                ShowdownResultView(
                    hand: showdowns[i],
                    match: match,
                    remainingPendingCount: 0,
                    hasNextPending: true,
                    onFavorite: { fav in
                        Task { await store.toggleFavorite(handId: showdowns[i].handId, favorite: fav) }
                    },
                    onBackToList: {},
                    onNextHand: advance,
                    nextTitle: isLast ? "Done \u{2713}" : "Next Showdown \u{2192}",
                    showBackToList: false
                )
                .id(showdowns[i].handId)   // reset per-hand reveal animation
            }
        }
    }

    private func advance() {
        if pageIndex >= pages.count - 1 { finish() }
        else { withAnimation { pageIndex += 1 } }
    }

    private func finish() {
        onDone()
    }
}

// A compact list of folded hands sharing one outcome — one screen for all
// blinds won, or all blinds lost, in a submitted turn.
struct FoldGroupView: View {
    let hands: [HandView]
    let match: MatchState
    let currentUserId: String?
    let won: Bool
    let onContinue: () -> Void

    private var opponentName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent"
    }

    private var allPreflop: Bool { hands.allSatisfy { ($0.foldStreet ?? $0.street) == "preflop" } }

    private var totalNet: Int { hands.reduce(0) { $0 + ($1.myResolvedNet ?? 0) } }

    private var headline: String {
        if won { return allPreflop ? "Blinds, yours." : "Hands won." }
        return allPreflop ? "Blinds, gone." : "Hands folded."
    }

    private var subtitle: String {
        won
            ? "\(opponentName) folded \(hands.count) hand\(hands.count == 1 ? "" : "s")"
            : "You folded \(hands.count) hand\(hands.count == 1 ? "" : "s")"
    }

    private var accent: Color { won ? .gold500 : .claret }

    var body: some View {
        ZStack {
            RadialGradient(
                gradient: Gradient(colors: [.felt500, .felt700, .felt800]),
                center: .top, startRadius: 0, endRadius: 600
            ).ignoresSafeArea()

            VStack(spacing: 0) {
                MatchHeaderBar(
                    myAvailable: match.myAvailable,
                    opponentName: opponentName,
                    opponentAvailable: match.opponentAvailable
                )

                Spacer()

                Text(won ? "\(hands.count) HANDS WON" : "\(hands.count) HANDS FOLDED")
                    .font(.system(size: 10, weight: .medium))
                    .tracking(3)
                    .foregroundColor(accent)
                    .padding(.bottom, 10)

                Text(headline)
                    .font(.custom("Georgia", size: 34))
                    .foregroundColor(.cream100)
                    .padding(.bottom, 4)

                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundColor(.cream300)
                    .padding(.bottom, 8)

                // Net total for the group.
                Text(netText(totalNet))
                    .font(.custom("Georgia", size: 44))
                    .foregroundColor(accent)
                    .padding(.bottom, 20)

                // Per-hand list.
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(hands) { hand in
                            row(hand)
                        }
                    }
                    .padding(.horizontal, 24)
                }
                .frame(maxHeight: 280)

                Spacer()

                Button {
                    CompletedHandHaptics.dismissImpact()
                    onContinue()
                } label: {
                    Text("Continue \u{2192}")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.felt800)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom))
                        .cornerRadius(12)
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 32)
            }
        }
    }

    private func row(_ hand: HandView) -> some View {
        let street = (hand.foldStreet ?? hand.street)
        let streetPhrase = street == "preflop" ? "preflop" : "the \(street)"
        return HStack(spacing: 10) {
            Text("H\(hand.handIndex + 1)")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.cream200)
                .frame(width: 26, alignment: .leading)
            HStack(spacing: 2) {
                ForEach(hand.myHole, id: \.self) { c in
                    PlayingCardView(card: c, size: .small)
                }
            }
            Text(won ? "\(opponentName) folded \(streetPhrase)" : "You folded \(streetPhrase)")
                .font(.system(size: 11))
                .foregroundColor(.cream300)
                .lineLimit(1)
            Spacer()
            if let net = hand.myResolvedNet {
                Text(netText(net))
                    .font(.custom("Georgia", size: 14))
                    .foregroundColor(accent)
            }
        }
        .padding(.vertical, 7)
        .padding(.horizontal, 10)
        .background(accent.opacity(0.05))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(accent.opacity(0.15), lineWidth: 1))
        .cornerRadius(8)
    }

    private func netText(_ net: Int) -> String {
        if net > 0 { return "+\(net)" }
        if net < 0 { return "\u{2212}\(abs(net))" }
        return "0"
    }
}

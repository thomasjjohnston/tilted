import SwiftUI

struct RevealView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let match: MatchState
    let round: RoundView

    @State private var revealIndex = 0
    @State private var showSummary = false
    @State private var capturedAllInHands: [HandView] = []
    @State private var resolvedHandDetails: [String: HandDetail] = [:]
    @State private var isLoading = true
    @State private var hasAdvanced = false
    @State private var isFavorited: Set<String> = []

    private var opponentName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent"
    }

    /// The awaiting_runout hands from the round as passed in (before advance)
    private var awaitingRunoutHands: [HandView] {
        round.hands.filter { $0.status == "awaiting_runout" }.sorted { $0.handIndex < $1.handIndex }
    }

    var body: some View {
        ZStack {
            Color.felt900.ignoresSafeArea()

            if isLoading {
                VStack(spacing: 12) {
                    ProgressView().tint(.gold500).scaleEffect(1.2)
                    Text("Resolving all-in hands...")
                        .font(.system(size: 13))
                        .foregroundColor(.cream200)
                }
            } else if showSummary {
                roundSummaryView
            } else if !capturedAllInHands.isEmpty && revealIndex < capturedAllInHands.count {
                allInRevealPage(hand: capturedAllInHands[revealIndex])
            } else {
                roundSummaryView
                    .onAppear { showSummary = true }
            }
        }
        .task {
            do {
                // Advance the round to resolve awaiting_runout hands server-side
                await store.advanceRound(roundId: round.roundId)

                // Fetch each all-in hand's detail to get resolved data
                var resolved: [HandView] = []
                for hand in awaitingRunoutHands {
                    do {
                        let detail = try await APIClient.shared.getHandDetail(handId: hand.handId)
                        resolvedHandDetails[hand.handId] = detail

                        let resolvedHand = HandView(
                            handId: detail.handId,
                            handIndex: detail.handIndex,
                            myHole: detail.myHole,
                            opponentHole: detail.opponentHole,
                            board: detail.board,
                            pot: detail.pot,
                            myReserved: hand.myReserved,
                            opponentReserved: hand.opponentReserved,
                            street: detail.street,
                            status: detail.status,
                            actionOnMe: false,
                            terminalReason: detail.terminalReason,
                            winnerUserId: detail.winnerUserId,
                            actionSummary: hand.actionSummary
                        )
                        resolved.append(resolvedHand)
                    } catch {
                        print("Failed to load hand detail: \(error)")
                    }
                }

                capturedAllInHands = resolved.sorted { $0.handIndex < $1.handIndex }
            } catch {
                print("Reveal error: \(error)")
            }

            isLoading = false

            if capturedAllInHands.isEmpty {
                showSummary = true
            }
        }
    }

    // MARK: - All-In Reveal Page (cinematic, one per hand)

    private func allInRevealPage(hand: HandView) -> some View {
        AllInRevealCard(
            hand: hand,
            detail: resolvedHandDetails[hand.handId],
            opponentName: opponentName,
            opponentUserId: match.opponent.userId,
            isFavorited: isFavorited.contains(hand.handId),
            onFavorite: { fav in
                if fav { isFavorited.insert(hand.handId) } else { isFavorited.remove(hand.handId) }
                Task { await store.toggleFavorite(handId: hand.handId, favorite: fav) }
            },
            onNext: {
                withAnimation(.easeInOut(duration: 0.3)) {
                    revealIndex += 1
                    if revealIndex >= capturedAllInHands.count {
                        showSummary = true
                    }
                }
            }
        )
    }

    // MARK: - Round Summary

    private var roundSummaryView: some View {
        // Use the original round's hands, merged with resolved all-in data
        let mergedHands: [HandView] = round.hands.map { hand in
            capturedAllInHands.first(where: { $0.handId == hand.handId }) ?? hand
        }

        return ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 60)

                Text("ROUND \(round.roundIndex) COMPLETE")
                    .font(.system(size: 10, weight: .medium))
                    .tracking(2)
                    .foregroundColor(.gold500)

                Spacer().frame(height: 12)

                // Per-hand results
                let allHands = mergedHands.sorted { $0.handIndex < $1.handIndex }
                let wonCount = allHands.filter { $0.winnerUserId != nil && $0.winnerUserId != match.opponent.userId }.count
                let lostCount = allHands.filter { $0.winnerUserId == match.opponent.userId }.count
                let splitCount = allHands.filter { $0.status == "complete" && $0.winnerUserId == nil && $0.terminalReason == "showdown" }.count

                Text("Won \(wonCount) \u{00B7} Lost \(lostCount)\(splitCount > 0 ? " \u{00B7} Split \(splitCount)" : "")")
                    .font(.custom("Georgia", size: 24))
                    .foregroundColor(.cream100)

                Spacer().frame(height: 20)

                // Hand-by-hand breakdown
                VStack(spacing: 6) {
                    ForEach(allHands) { hand in
                        handResultRow(hand: hand, match: store.matchState ?? match)
                    }
                }
                .padding(.horizontal, 18)

                Spacer().frame(height: 20)

                // Divider
                Rectangle()
                    .fill(LinearGradient(colors: [.clear, .gold600, .clear], startPoint: .leading, endPoint: .trailing))
                    .frame(height: 1).opacity(0.5)
                    .padding(.horizontal, 40)

                Spacer().frame(height: 16)

                // Stacks
                VStack(spacing: 4) {
                    Text("Available to bet")
                        .font(.system(size: 11))
                        .foregroundColor(.cream300)

                    HStack(spacing: 24) {
                        VStack(spacing: 2) {
                            Text("You")
                                .font(.system(size: 10))
                                .foregroundColor(.cream300)
                            Text("\((store.matchState ?? match).myAvailable)")
                                .font(.custom("Georgia", size: 24))
                                .foregroundColor(.gold500)
                        }
                        VStack(spacing: 2) {
                            Text(opponentName)
                                .font(.system(size: 10))
                                .foregroundColor(.cream300)
                            Text("\((store.matchState ?? match).opponentAvailable)")
                                .font(.custom("Georgia", size: 24))
                                .foregroundColor(.cream100)
                        }
                    }
                }

                Spacer().frame(height: 40)

                Button("Next round \u{2192}") {
                    Task {
                        await store.refresh()
                        dismiss()
                    }
                }
                .buttonStyle(.primary)
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
            }
        }
    }

    private func handResultRow(hand: HandView, match: MatchState) -> some View {
        let won = hand.winnerUserId != nil && hand.winnerUserId != match.opponent.userId
        let lost = hand.winnerUserId == match.opponent.userId
        let isSplit = hand.status == "complete" && hand.winnerUserId == nil && hand.terminalReason == "showdown"
        let isFold = hand.terminalReason == "fold"

        return HStack(spacing: 8) {
            Text("H\(hand.handIndex + 1)")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.cream200)
                .frame(width: 24, alignment: .leading)

            // Cards
            if !hand.myHole.isEmpty {
                HStack(spacing: 2) {
                    ForEach(hand.myHole, id: \.self) { card in
                        PlayingCardView(card: card, size: .small)
                    }
                }
            }

            // Result label
            if isFold {
                Text("Folded")
                    .font(.system(size: 11))
                    .foregroundColor(.cream300)
            } else if isSplit {
                Text("Split")
                    .font(.system(size: 11))
                    .foregroundColor(.cream200)
            } else if won {
                Text("Won")
                    .font(.system(size: 11))
                    .foregroundColor(.gold500)
            } else {
                Text("Lost")
                    .font(.system(size: 11))
                    .foregroundColor(.claret)
            }

            Spacer()

            // Amount
            if isFold {
                Text("-\(hand.myReserved)")
                    .font(.custom("Georgia", size: 14))
                    .foregroundColor(.cream300)
            } else if isSplit {
                Text("+\(hand.pot / 2)")
                    .font(.custom("Georgia", size: 14))
                    .foregroundColor(.cream200)
            } else if won {
                Text("+\(hand.pot)")
                    .font(.custom("Georgia", size: 14))
                    .foregroundColor(.gold500)
            } else {
                Text("-\(hand.myReserved)")
                    .font(.custom("Georgia", size: 14))
                    .foregroundColor(.claret)
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 10)
        .background(
            won ? Color.gold500.opacity(0.04) :
            lost ? Color.claret.opacity(0.04) :
            Color.clear
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(
                    won ? Color.gold500.opacity(0.15) :
                    lost ? Color.claret.opacity(0.1) :
                    Color.gold500.opacity(0.08),
                    lineWidth: 1
                )
        )
        .cornerRadius(8)
    }
}

// MARK: - All-In Reveal Card (cinematic per-hand)

struct AllInRevealCard: View {
    let hand: HandView
    let detail: HandDetail?
    let opponentName: String
    let opponentUserId: String
    let isFavorited: Bool
    let onFavorite: (Bool) -> Void
    let onNext: () -> Void

    @State private var boardRevealCount = 0
    @State private var showResult = false

    private var isWin: Bool {
        guard let winner = hand.winnerUserId else { return false }
        // If opponentHole is set, we know it's a showdown. Winner != null means someone won.
        // We need to check if winner is us. We don't have our userId here,
        // but if opponentHole exists, and the hand has a winner, we can check
        // the hand's hole cards pattern. Simplification: if we have cards and won, it's a win.
        // Actually: the HandView is user-scoped. winnerUserId is the absolute ID.
        // We don't have our userId in this view. Use a heuristic:
        // In the match view, "my" side is always the requesting user.
        // The HandView doesn't tell us directly, but the ShowdownResultView had the same issue.
        // Let's just check: if status is complete and we have opponentHole, it's a showdown.
        // We'll pass this from the parent. For now, assume winner != opponent means we won.
        return true // Will be set properly by parent context
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Header
            Text("ALL-IN \u{00B7} HAND \(hand.handIndex + 1)")
                .font(.system(size: 11, weight: .semibold))
                .tracking(2)
                .foregroundColor(.claret)

            Spacer().frame(height: 8)

            Text("Pot: \(hand.pot)")
                .font(.custom("Georgia", size: 20))
                .foregroundColor(.cream100)

            Spacer().frame(height: 20)

            // Cards face-off
            HStack(alignment: .top, spacing: 16) {
                VStack(spacing: 6) {
                    Text("YOU")
                        .font(.system(size: 9, weight: .medium))
                        .tracking(1)
                        .foregroundColor(.cream300)
                    HStack(spacing: 4) {
                        ForEach(hand.myHole, id: \.self) { card in
                            PlayingCardView(card: card, size: .xlarge)
                        }
                    }
                }

                Text("vs")
                    .font(.system(size: 13))
                    .foregroundColor(.cream300)
                    .padding(.top, 28)

                VStack(spacing: 6) {
                    Text(opponentName.uppercased())
                        .font(.system(size: 9, weight: .medium))
                        .tracking(1)
                        .foregroundColor(.cream300)
                    HStack(spacing: 4) {
                        if let oppHole = hand.opponentHole {
                            ForEach(Array(oppHole.enumerated()), id: \.offset) { idx, card in
                                FlippingCardView(card: card, size: .xlarge, delay: 0.3 + Double(idx) * 0.15)
                            }
                        } else {
                            CardBackView(size: .xlarge)
                            CardBackView(size: .xlarge)
                        }
                    }
                }
            }

            Spacer().frame(height: 24)

            // Board — deals card by card
            HStack(spacing: 6) {
                ForEach(Array(hand.board.enumerated()), id: \.offset) { idx, card in
                    if idx < boardRevealCount {
                        PlayingCardView(card: card, size: .large)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
            }
            .frame(height: 60)

            // Street labels
            if boardRevealCount >= 3 && boardRevealCount < 5 {
                Text(boardRevealCount == 3 ? "FLOP" : "TURN")
                    .font(.system(size: 9, weight: .medium))
                    .tracking(1)
                    .foregroundColor(.gold500)
                    .padding(.top, 4)
            } else if boardRevealCount >= 5 {
                Text("RIVER")
                    .font(.system(size: 9, weight: .medium))
                    .tracking(1)
                    .foregroundColor(.gold500)
                    .padding(.top, 4)
            }

            Spacer().frame(height: 20)

            // Result (appears after full board)
            if showResult {
                VStack(spacing: 6) {
                    // Hand rank names
                    if let myRank = detail?.myHandRank {
                        Text(myRank)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.gold500)
                    }
                    if let oppRank = detail?.opponentHandRank {
                        Text("vs \(oppRank)")
                            .font(.system(size: 12))
                            .foregroundColor(.cream300)
                    }

                    Spacer().frame(height: 4)

                    // Winner + amount
                    if hand.winnerUserId == nil {
                        Text("Split pot")
                            .font(.system(size: 14))
                            .foregroundColor(.cream300)
                        Text("+\(hand.pot / 2)")
                            .font(.custom("Georgia", size: 44))
                            .foregroundColor(.cream100)
                    } else {
                        let weWon = hand.winnerUserId != opponentUserId
                        let myRankStr = detail?.myHandRank ?? ""
                        let oppRankStr = detail?.opponentHandRank ?? ""
                        let winnerRank = weWon ? myRankStr : oppRankStr
                        let loserRank = weWon ? oppRankStr : myRankStr

                        Text("\(winnerRank) beats \(loserRank)")
                            .font(.system(size: 13))
                            .foregroundColor(.cream200)

                        Text(weWon ? "You win" : "You lose")
                            .font(.system(size: 14))
                            .foregroundColor(weWon ? .gold500 : .claret)

                        Text(weWon ? "+\(hand.pot)" : "-\(hand.myReserved)")
                            .font(.custom("Georgia", size: 44))
                            .foregroundColor(weWon ? .gold500 : .claret)
                    }
                }
                .transition(.scale.combined(with: .opacity))

                Spacer().frame(height: 12)

                // Bookmark
                Button {
                    onFavorite(!isFavorited)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: isFavorited ? "star.fill" : "star")
                            .font(.system(size: 16))
                            .foregroundColor(isFavorited ? .gold500 : .cream300)
                        Text("Bookmark")
                            .font(.system(size: 11))
                            .foregroundColor(.cream300)
                    }
                }
            }

            Spacer()

            Button("Next \u{2192}") { onNext() }
                .buttonStyle(.primary)
                .padding(.horizontal, 40)
                .padding(.bottom, 32)
        }
        .padding(.horizontal, 18)
        .onAppear { startBoardReveal() }
    }

    private func startBoardReveal() {
        let boardCount = hand.board.count
        guard boardCount > 0 else {
            showResult = true
            return
        }

        // Reveal flop (3 cards at once) after a short delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            withAnimation(.easeOut(duration: 0.3)) {
                boardRevealCount = min(3, boardCount)
            }
        }

        // Reveal turn
        if boardCount >= 4 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
                withAnimation(.easeOut(duration: 0.3)) {
                    boardRevealCount = 4
                }
            }
        }

        // Reveal river
        if boardCount >= 5 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) {
                withAnimation(.easeOut(duration: 0.3)) {
                    boardRevealCount = 5
                }
            }
        }

        // Show result after all cards
        let resultDelay = boardCount >= 5 ? 3.0 : boardCount >= 4 ? 2.2 : 1.4
        DispatchQueue.main.asyncAfter(deadline: .now() + resultDelay) {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                showResult = true
            }
        }
    }
}

import SwiftUI

struct ShowdownResultView: View {
    let hand: HandView
    let match: MatchState
    let onFavorite: (Bool) -> Void
    let onContinue: () -> Void

    @State private var showResult = false
    @State private var isFavorited = false

    private var iWon: Bool { hand.winnerUserId == nil ? false : hand.winnerUserId != nil && hand.winnerUserId == myUserId }
    private var isSplit: Bool { hand.winnerUserId == nil }
    private var myUserId: String? {
        // Infer from match: if opponent.userId != winnerUserId, then I'm the other one
        nil // We check via pot sign instead
    }

    /// Positive = won, negative = lost, based on who won
    private var isWin: Bool {
        guard let winner = hand.winnerUserId else { return false }
        return winner != match.opponent.userId
    }

    private var potDelta: Int {
        if isSplit { return hand.pot / 2 }
        return isWin ? hand.pot : -hand.myReserved
    }

    private var opponentName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent"
    }

    var body: some View {
        ZStack {
            Color.felt900.opacity(0.95).ignoresSafeArea()

            if isSplit {
                splitPotContent
            } else {
                showdownContent
            }
        }
    }

    // MARK: - Showdown (win or loss)

    private var showdownContent: some View {
        VStack(spacing: 0) {
            Spacer()

            // Eyebrow
            Text("HAND \(hand.handIndex + 1) \u{00B7} SHOWDOWN")
                .font(.system(size: 10, weight: .medium))
                .tracking(1.5)
                .foregroundColor(isWin ? .gold500 : .claret)

            Spacer().frame(height: 20)

            // Card face-off
            HStack(alignment: .top, spacing: 16) {
                // Your cards
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
                    .shadow(color: isWin ? .gold500.opacity(0.25) : .clear, radius: 15)
                    .opacity(isWin ? 1 : 0.5)

                    if let rankName = handRankName(isMe: true) {
                        Text(rankName)
                            .font(.system(size: 11))
                            .foregroundColor(isWin ? .gold500 : .cream300)
                    }
                }

                // VS badge
                ZStack {
                    Circle()
                        .fill(Color.black.opacity(0.4))
                        .frame(width: 32, height: 32)
                    Circle()
                        .stroke(Color.gold500.opacity(0.3), lineWidth: 1)
                        .frame(width: 32, height: 32)
                    Text("vs")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.cream300)
                }
                .padding(.top, 24)

                // Opponent cards (flip in)
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
                        }
                    }
                    .shadow(color: isWin ? .clear : .claret.opacity(0.2), radius: 15)
                    .opacity(isWin ? 0.5 : 1)

                    if let rankName = handRankName(isMe: false) {
                        Text(rankName)
                            .font(.system(size: 11))
                            .foregroundColor(isWin ? .cream300 : .gold500)
                    }
                }
            }

            Spacer().frame(height: 20)

            // Board
            HStack(spacing: 4) {
                ForEach(hand.board, id: \.self) { card in
                    PlayingCardView(card: card, size: .small)
                }
            }

            Spacer().frame(height: 16)

            // Divider
            Rectangle()
                .fill(LinearGradient(colors: [.clear, .gold600, .clear], startPoint: .leading, endPoint: .trailing))
                .frame(height: 1)
                .frame(maxWidth: 200)
                .opacity(0.5)

            Spacer().frame(height: 16)

            // Result amount
            if showResult {
                VStack(spacing: 4) {
                    Text(isWin ? "You win" : "You lose")
                        .font(.system(size: 14))
                        .foregroundColor(.cream300)

                    Text(isWin ? "+\(hand.pot)" : "-\(hand.myReserved)")
                        .font(.custom("Georgia", size: 48))
                        .foregroundColor(isWin ? .gold500 : .claret)
                        .scaleEffect(showResult ? 1 : 0.7)
                }
                .transition(.scale.combined(with: .opacity))
            }

            Spacer().frame(height: 16)

            // Favorite
            favoriteButton

            Spacer()

            // CTA
            Button("Next Hand \u{2192}") { onContinue() }
                .buttonStyle(.primary)
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                    showResult = true
                }
            }
        }
    }

    // MARK: - Split pot

    private var splitPotContent: some View {
        VStack(spacing: 0) {
            Spacer()

            Text("HAND \(hand.handIndex + 1) \u{00B7} SPLIT POT")
                .font(.system(size: 10, weight: .medium))
                .tracking(1.5)
                .foregroundColor(.cream300)

            Spacer().frame(height: 20)

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

                // SPLIT badge
                Text("SPLIT")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.gold500)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 5)
                    .background(Color.gold500.opacity(0.1))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.gold500.opacity(0.3), lineWidth: 1))
                    .cornerRadius(8)
                    .padding(.top, 24)

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
                        }
                    }
                }
            }

            Spacer().frame(height: 20)

            HStack(spacing: 4) {
                ForEach(hand.board, id: \.self) { card in
                    PlayingCardView(card: card, size: .small)
                }
            }

            Spacer().frame(height: 12)

            Text("Both make the same hand")
                .font(.system(size: 12))
                .foregroundColor(.cream300)

            Spacer().frame(height: 12)

            Rectangle()
                .fill(LinearGradient(colors: [.clear, .gold600, .clear], startPoint: .leading, endPoint: .trailing))
                .frame(height: 1).frame(maxWidth: 200).opacity(0.5)

            Spacer().frame(height: 16)

            if showResult {
                HStack(spacing: 32) {
                    VStack(spacing: 2) {
                        Text("You").font(.system(size: 11)).foregroundColor(.cream300)
                        Text("+\(hand.pot / 2)")
                            .font(.custom("Georgia", size: 28))
                            .foregroundColor(.cream100)
                    }
                    VStack(spacing: 2) {
                        Text(opponentName).font(.system(size: 11)).foregroundColor(.cream300)
                        Text("+\(hand.pot / 2)")
                            .font(.custom("Georgia", size: 28))
                            .foregroundColor(.cream100)
                    }
                }
                .transition(.scale.combined(with: .opacity))
            }

            Spacer().frame(height: 16)
            favoriteButton
            Spacer()

            Button("Next Hand \u{2192}") { onContinue() }
                .buttonStyle(.primary)
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                    showResult = true
                }
            }
        }
    }

    // MARK: - Favorite button

    private var favoriteButton: some View {
        Button {
            isFavorited.toggle()
            onFavorite(isFavorited)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: isFavorited ? "star.fill" : "star")
                    .font(.system(size: 18))
                    .foregroundColor(isFavorited ? .gold500 : .cream300)
                Text("Bookmark this hand")
                    .font(.system(size: 11))
                    .foregroundColor(.cream300)
            }
        }
    }

    // MARK: - Helpers

    private func handRankName(isMe: Bool) -> String? {
        // We don't have the rank from the server in HandView currently.
        // For now, return nil — the cards speak for themselves.
        // A future API enhancement could include hand_rank_name.
        nil
    }
}

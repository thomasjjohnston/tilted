import SwiftUI

// Shared building blocks for the new Match-Up surface: felt table, dealer
// button, posted blinds, position banner, and the 10-hand bottom strip.
// All views are stateless and consume data via plain inputs.

// MARK: - Dealer button

struct DealerButton: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [.cream50, .cream200],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            Text("D")
                .font(.custom("Georgia", size: 12).bold())
                .foregroundColor(.cardBlack)
        }
        .frame(width: 22, height: 22)
        .overlay(Circle().stroke(Color.black.opacity(0.18), lineWidth: 1))
        .shadow(color: .black.opacity(0.45), radius: 1, y: 1)
    }
}

// MARK: - Posted blind chip

struct BlindChip: View {
    enum Position { case sb, bb }
    let position: Position
    let amount: Int
    var compact: Bool = false

    private var gradient: LinearGradient {
        switch position {
        case .sb:
            return LinearGradient(
                colors: [Color(hex: 0x4a6a3a), Color(hex: 0x2a3f24)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        case .bb:
            return LinearGradient(
                colors: [Color(hex: 0xc44d42), Color(hex: 0x7a2920)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }

    private var label: String { position == .sb ? "SB" : "BB" }

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                Circle()
                    .fill(gradient)
                    .overlay(
                        Circle()
                            .strokeBorder(Color.white.opacity(0.18),
                                          style: StrokeStyle(lineWidth: 2, dash: [3, 2]))
                    )
                Text(label)
                    .font(.custom("Georgia", size: compact ? 7 : 9).bold())
                    .foregroundColor(.cream50)
            }
            .frame(width: compact ? 18 : 22, height: compact ? 18 : 22)
            .shadow(color: .black.opacity(0.45), radius: 1, y: 1)
            if !compact {
                Text("\(amount)")
                    .font(.custom("Georgia", size: 10))
                    .foregroundColor(.cream200)
            }
        }
    }
}

// MARK: - Position banner

struct PositionBanner: View {
    let myRole: String           // "sb" or "bb"
    let actingOrderHint: String? // e.g. "acts 2nd preflop · 1st postflop"
    var danger: Bool = false

    private var isBB: Bool { myRole.lowercased() == "bb" }

    var body: some View {
        HStack(spacing: 10) {
            BlindChip(position: isBB ? .bb : .sb, amount: 0, compact: true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text("You're the")
                        .font(.system(size: 11))
                        .foregroundColor(.cream200)
                    Text(isBB ? "Big Blind" : "Small Blind")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.gold500)
                }
                if let hint = actingOrderHint {
                    Text(hint)
                        .font(.system(size: 10))
                        .foregroundColor(.cream300)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(
            (danger ? Color.claret.opacity(0.08) : Color.black.opacity(0.25))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(danger ? Color.claret.opacity(0.3) : Color.gold500.opacity(0.18),
                        lineWidth: 1)
        )
        .cornerRadius(10)
    }
}

// MARK: - Felt table (heads-up, single-hand focus)

struct FeltTableView: View {
    let hand: HandView
    let match: MatchState
    let myRole: String   // "sb" or "bb"
    let smallBlind: Int
    let bigBlind: Int

    private var isBB: Bool { myRole.lowercased() == "bb" }
    private var opponentInitial: String {
        let first = match.opponent.displayName.first.map(String.init) ?? "?"
        return first.uppercased()
    }

    var body: some View {
        VStack(spacing: 6) {
            opponentRow
            opponentCardsRow
            tableCenter
            youRow
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 18)
        .background(
            RadialGradient(
                gradient: Gradient(colors: [
                    Color(hex: 0x19533f),
                    Color(hex: 0x11463a),
                    Color(hex: 0x0e3b2e)
                ]),
                center: UnitPoint(x: 0.5, y: 0.45),
                startRadius: 30,
                endRadius: 240
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 80, style: .continuous)
                .strokeBorder(Color.gold500.opacity(0.22), lineWidth: 2)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 80, style: .continuous)
                .strokeBorder(Color.black.opacity(0.4), lineWidth: 4)
                .offset(y: -1)
                .blendMode(.multiply)
        )
        .clipShape(RoundedRectangle(cornerRadius: 80, style: .continuous))
        .shadow(color: .black.opacity(0.4), radius: 8, y: 6)
    }

    // MARK: opponent

    private var opponentRow: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: 0x5a3a8a), Color(hex: 0x2a1f4a)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                Text(opponentInitial)
                    .font(.custom("Georgia", size: 14).bold())
                    .foregroundColor(.cream100)
            }
            .frame(width: 34, height: 34)
            .overlay(Circle().stroke(Color.gold500.opacity(0.45), lineWidth: 1.5))

            VStack(alignment: .leading, spacing: 1) {
                Text(match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.cream100)
                Text("\(match.opponentAvailable)")
                    .font(.custom("Georgia", size: 13))
                    .foregroundColor(.gold500)
            }
            Spacer()
        }
    }

    private var opponentCardsRow: some View {
        HStack(spacing: 3) {
            // Reveal opponent cards only at showdown or after runout
            if let oppHole = hand.opponentHole, !oppHole.isEmpty {
                ForEach(oppHole, id: \.self) { card in
                    PlayingCardView(card: card, size: .small)
                }
            } else if hand.terminalReason == "fold" && hand.winnerUserId != match.opponent.userId {
                // Opponent folded — show mucked cards
                MuckPlaceholderView(size: .small)
                MuckPlaceholderView(size: .small)
            } else {
                CardBackView(size: .small)
                CardBackView(size: .small)
            }
        }
    }

    // MARK: center

    private var tableCenter: some View {
        let layout = FeltLayoutResolver.resolve(isBB: isBB)
        return VStack(spacing: 6) {
            // Opponent's blind chip + dealer button (button stays with SB)
            HStack(spacing: 8) {
                BlindChip(position: layout.oppChip, amount: layout.oppChip == .sb ? smallBlind : bigBlind)
                if layout.oppHasDealer { DealerButton() }
            }

            // Board cards
            HStack(spacing: 4) {
                ForEach(Array(hand.board.enumerated()), id: \.offset) { _, card in
                    PlayingCardView(card: card, size: .small)
                }
                ForEach(0..<max(0, 5 - hand.board.count), id: \.self) { _ in
                    CardPlaceholderView(size: .small)
                }
            }
            .padding(.vertical, 2)

            // Pot
            HStack(spacing: 6) {
                Text("POT")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1.5)
                    .foregroundColor(.cream300)
                Text("\(hand.pot)")
                    .font(.custom("Georgia", size: 16).bold())
                    .foregroundColor(.gold500)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .background(Color.black.opacity(0.35))
            .overlay(
                Capsule().stroke(Color.gold500.opacity(0.3), lineWidth: 1)
            )
            .clipShape(Capsule())

            // Last action callout
            if let last = hand.lastAction {
                lastActionPill(last)
            }

            // Your blind chip + dealer button (button stays with SB)
            HStack(spacing: 8) {
                if layout.userHasDealer { DealerButton() }
                BlindChip(position: layout.userChip, amount: layout.userChip == .sb ? smallBlind : bigBlind)
            }
        }
    }

    private func lastActionPill(_ last: HandLastAction) -> some View {
        let oppName = match.opponent.displayName.components(separatedBy: " ").first ?? "Opp"
        let phrase: String = {
            switch last.actionType {
            case "fold": return "folded"
            case "check": return "checked"
            case "call": return last.amount > 0 ? "called \(last.amount)" : "called"
            case "bet": return "bet \(last.amount)"
            case "raise": return "raised to \(last.amount)"
            case "all_in": return "shoved all-in \(last.amount)"
            default: return last.actionType
            }
        }()
        let isAllIn = last.actionType == "all_in"
        return HStack(spacing: 6) {
            Text(oppName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(isAllIn ? .claret : .gold500)
            Text(phrase)
                .font(.system(size: 11))
                .foregroundColor(.cream100)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(
            isAllIn ? Color.claret.opacity(0.15) : Color.gold500.opacity(0.1)
        )
        .overlay(
            Capsule().stroke(
                isAllIn ? Color.claret.opacity(0.3) : Color.gold500.opacity(0.25),
                lineWidth: 1
            )
        )
        .clipShape(Capsule())
    }

    // MARK: you

    private var youRow: some View {
        HStack(spacing: 14) {
            HStack(spacing: 3) {
                ForEach(hand.myHole, id: \.self) { card in
                    PlayingCardView(card: card, size: .regular)
                }
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("You")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.cream100)
                HStack(spacing: 4) {
                    Text("stack")
                        .font(.system(size: 9))
                        .tracking(1)
                        .foregroundColor(.cream300)
                    Text("\(match.myAvailable)")
                        .font(.custom("Georgia", size: 14).bold())
                        .foregroundColor(.gold500)
                }
            }
            Spacer()
        }
    }
}

// MARK: - 10-hand strip

struct HandStrip: View {
    let hands: [HandView]
    let currentUserId: String?
    let focusedHandId: String?
    let onSelect: (HandView) -> Void

    var body: some View {
        VStack(spacing: 8) {
            Text("ALL 10 HANDS · TAP TO FOCUS")
                .font(.system(size: 9, weight: .medium))
                .tracking(1.5)
                .foregroundColor(.cream300)

            HStack(spacing: 4) {
                ForEach(hands) { hand in
                    HandPuck(
                        hand: hand,
                        currentUserId: currentUserId,
                        isFocused: hand.handId == focusedHandId
                    )
                    .onTapGesture { onSelect(hand) }
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(Color.black.opacity(0.4))
        .overlay(
            Rectangle()
                .fill(Color.gold500.opacity(0.18))
                .frame(height: 1),
            alignment: .top
        )
    }
}

struct HandPuck: View {
    let hand: HandView
    let currentUserId: String?
    let isFocused: Bool

    enum State { case pending, waiting, won, lost, splitPot, awaitingRunout }

    private var state: State {
        if hand.status == "awaiting_runout" { return .awaitingRunout }
        if hand.status == "complete" {
            if hand.winnerUserId == nil { return .splitPot }
            return hand.winnerUserId == currentUserId ? .won : .lost
        }
        return hand.actionOnMe ? .pending : .waiting
    }

    private var iconColor: Color {
        switch state {
        case .pending: return .gold500
        case .waiting: return .cream300
        case .won: return Color(hex: 0x4ea878)
        case .lost: return .cream300
        case .splitPot: return .cream300
        case .awaitingRunout: return .claret
        }
    }

    private var iconChar: String {
        switch state {
        case .pending: return "●"
        case .waiting: return "⏳"
        case .won: return "✓"
        case .lost: return "✗"
        case .splitPot: return "⚖"
        case .awaitingRunout: return "⚡"
        }
    }

    private var border: Color {
        if isFocused { return Color.gold500.opacity(0.7) }
        switch state {
        case .pending: return Color.gold500.opacity(0.45)
        case .won: return Color(hex: 0x4ea878).opacity(0.35)
        case .lost: return Color.cream400.opacity(0.25)
        case .awaitingRunout: return Color.claret.opacity(0.45)
        default: return Color.gold500.opacity(0.15)
        }
    }

    private var bg: Color {
        if isFocused { return Color.gold500.opacity(0.18) }
        switch state {
        case .pending: return Color.gold500.opacity(0.06)
        case .won: return Color(hex: 0x4ea878).opacity(0.1)
        case .lost: return Color.cream400.opacity(0.05)
        case .awaitingRunout: return Color.claret.opacity(0.08)
        default: return Color.black.opacity(0.3)
        }
    }

    private var numColor: Color {
        if state == .won { return Color(hex: 0x4ea878) }
        if state == .pending || isFocused { return .gold500 }
        return .cream200
    }

    var body: some View {
        VStack(spacing: 2) {
            Text("\(hand.handIndex + 1)")
                .font(.custom("Georgia", size: 11).bold())
                .foregroundColor(numColor)
            Text(iconChar)
                .font(.system(size: 9))
                .foregroundColor(iconColor)
            if let net = hand.myResolvedNet, hand.status == "complete" {
                Text(net >= 0 ? "+\(net)" : "\(net)")
                    .font(.custom("Georgia", size: 9))
                    .foregroundColor(net >= 0 ? Color(hex: 0x4ea878) : .claret)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            } else {
                Text(" ")
                    .font(.custom("Georgia", size: 9))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 5)
        .background(bg)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(border, lineWidth: isFocused ? 1.5 : 1)
        )
        .cornerRadius(8)
        .shadow(
            color: isFocused ? Color.gold500.opacity(0.25) : .clear,
            radius: isFocused ? 8 : 0
        )
    }
}

// MARK: - Felt layout resolver

/// Pure mapping from `isBB` (whether the user is the Big Blind) to the
/// chip + dealer button placement on each side of the felt. Extracted
/// from the view so it can be unit-tested without instantiating SwiftUI.
///
/// Heads-up rule: the dealer button sits with the Small Blind. So:
///   - User is SB  → user side has dealer, opponent shows BB chip
///   - User is BB  → opponent side has dealer, user shows BB chip
struct FeltLayout: Equatable {
    let oppHasDealer: Bool
    let oppChip: BlindChip.Position
    let userHasDealer: Bool
    let userChip: BlindChip.Position
}

enum FeltLayoutResolver {
    static func resolve(isBB: Bool) -> FeltLayout {
        if isBB {
            return FeltLayout(
                oppHasDealer: true,
                oppChip: .sb,
                userHasDealer: false,
                userChip: .bb
            )
        }
        return FeltLayout(
            oppHasDealer: false,
            oppChip: .bb,
            userHasDealer: true,
            userChip: .sb
        )
    }
}

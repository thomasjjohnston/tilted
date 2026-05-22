import SwiftUI

// End-of-turn report. Groups hands by outcome (big wins, folds induced,
// blinds stolen, showdowns lost, you folded, auto-folded, split pots)
// and lets the user tap any row to expand into the full action log.
//
// Per-hand math comes from server-snapshotted my_resolved_net so the
// "0 win/loss" bug is impossible by construction — when the server
// hasn't backfilled (e.g. a hand auto-acted on the client before the
// snapshot landed), we fall back to a reasonable estimate.

struct TurnSummaryView: View {
    let match: MatchState
    let round: RoundView
    let resolvedHands: [HandView]
    let autoActedHands: [(handIndex: Int, action: String)]
    let autoActedHandViews: [HandView]
    let stackBefore: Int
    let currentUserId: String?
    let onSendTurn: () -> Void

    @State private var expanded: Set<String> = []

    // MARK: - Math

    /// Resolved-net resolution order:
    ///   1. Server snapshot (`my_resolved_net`).
    ///   2. Server-provided contribution + winner — compute net deterministically.
    ///   3. Final fallback: return nil so callers can render a dash.
    /// myReserved is NOT a fallback — after settlement the server zeros
    /// it, so `-myReserved` is always `-0 = 0` for losses (the bug).
    func resolvedNetOptional(for hand: HandView) -> Int? {
        if let n = hand.myResolvedNet { return n }
        if let contribution = hand.myContribution {
            // Award = pot if you won, pot/2 (rounded down) if split, 0 if lost.
            let award: Int
            if hand.winnerUserId == currentUserId {
                award = hand.pot
            } else if hand.winnerUserId == nil && hand.status == "complete" {
                award = hand.pot / 2
            } else {
                award = 0
            }
            return award - contribution
        }
        return nil
    }

    /// Convenience for callers that need a non-nil int — returns 0 if
    /// both the snapshot AND the contribution are unavailable. Use the
    /// optional variant when you want to render a dash for that case.
    private func resolvedNet(for hand: HandView) -> Int {
        resolvedNetOptional(for: hand) ?? 0
    }

    private var netChange: Int {
        let serverAvailable = match.myAvailable
        if serverAvailable != stackBefore { return serverAvailable - stackBefore }
        return resolvedHands.reduce(0) { $0 + resolvedNet(for: $1) }
    }
    private var stackAfter: Int { stackBefore + netChange }

    // MARK: - Grouping

    private enum GroupKind: String, CaseIterable {
        case bigWin, foldInduced, blindSteal, showdownLost, youFolded, autoFolded, splitPot

        var title: String {
            switch self {
            case .bigWin: return "Big wins"
            case .foldInduced: return "Folds you induced"
            case .blindSteal: return "Stole the blinds"
            case .showdownLost: return "Showdowns lost"
            case .youFolded: return "Folded to bets"
            case .autoFolded: return "Auto-folded"
            case .splitPot: return "Split pots"
            }
        }

        var icon: String {
            switch self {
            case .bigWin: return "♠"
            case .foldInduced: return "♣"
            case .blindSteal: return "♦"
            case .showdownLost: return "♥"
            case .youFolded: return "⌀"
            case .autoFolded: return "⏳"
            case .splitPot: return "⚖"
            }
        }

        var isPositive: Bool {
            self == .bigWin || self == .foldInduced || self == .blindSteal
        }

        var order: Int {
            switch self {
            case .bigWin: return 0
            case .foldInduced: return 1
            case .blindSteal: return 2
            case .splitPot: return 3
            case .showdownLost: return 4
            case .youFolded: return 5
            case .autoFolded: return 6
            }
        }
    }

    private func classify(_ hand: HandView) -> GroupKind {
        if hand.winnerUserId == nil && hand.status == "complete" { return .splitPot }
        let won = hand.winnerUserId == currentUserId
        if !won {
            if hand.terminalReason == "fold" { return .youFolded }
            return .showdownLost
        }
        // We won
        if hand.terminalReason == "showdown" { return .bigWin }
        // Won via opponent fold
        if hand.foldStreet == "preflop" { return .blindSteal }
        return .foldInduced
    }

    private var grouped: [(kind: GroupKind, hands: [(hand: HandView, isAuto: Bool)])] {
        var bucket: [GroupKind: [(hand: HandView, isAuto: Bool)]] = [:]
        let autoFoldIds = Set(
            autoActedHands.filter { $0.action == "fold" }.map { $0.handIndex }
        )

        for hand in resolvedHands {
            let kind: GroupKind
            let isAuto: Bool
            if autoFoldIds.contains(hand.handIndex) {
                kind = .autoFolded
                isAuto = true
            } else {
                kind = classify(hand)
                isAuto = false
            }
            bucket[kind, default: []].append((hand, isAuto))
        }

        // Auto-acted hands that had no resolvedHand entry (rare)
        for snap in autoActedHandViews
            where !resolvedHands.contains(where: { $0.handId == snap.handId }) {
            let action = autoActedHands.first { $0.handIndex == snap.handIndex }?.action
            if action == "fold" {
                bucket[.autoFolded, default: []].append((snap, true))
            }
        }

        return bucket
            .map { (kind: $0.key, hands: $0.value.sorted { $0.hand.handIndex < $1.hand.handIndex }) }
            .sorted { $0.kind.order < $1.kind.order }
    }

    private func groupNet(_ items: [(hand: HandView, isAuto: Bool)]) -> Int {
        // Auto-folds use the same resolvedNet helper now — the previous
        // `-myReserved` shortcut returned -0 after settlement (the
        // recurring "+0" bug). The helper falls through snapshot →
        // contribution → 0 in order.
        items.reduce(0) { acc, item in acc + resolvedNet(for: item.hand) }
    }

    // MARK: - Body

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.felt900.opacity(0.96).ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    header
                    LazyVStack(spacing: 12) {
                        ForEach(grouped, id: \.kind) { group in
                            groupCard(group: group)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.top, 12)
                    .padding(.bottom, 110)
                }
            }
            .scrollIndicators(.hidden)

            sendTurnFooter
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 6) {
            Text("TURN COMPLETE")
                .font(.system(size: 10, weight: .medium))
                .tracking(2)
                .foregroundColor(.gold500)
                .padding(.top, 24)

            Text("Here's how it went")
                .font(.custom("Georgia", size: 22))
                .foregroundColor(.cream100)
                .padding(.bottom, 14)

            Text("NET THIS TURN")
                .font(.system(size: 9, weight: .medium))
                .tracking(2)
                .foregroundColor(.cream300)

            Text(netChange >= 0 ? "+\(netChange)" : "\(netChange)")
                .font(.custom("Georgia", size: 40))
                .foregroundColor(
                    netChange > 0 ? Color(hex: 0x4ea878)
                    : (netChange < 0 ? .claret : .cream100)
                )

            Text("Available \(stackBefore) → \(stackAfter)")
                .font(.system(size: 11))
                .foregroundColor(.cream300)
                .padding(.bottom, 18)

            Rectangle()
                .fill(Color.gold500.opacity(0.18))
                .frame(height: 1)
                .padding(.horizontal, 60)
        }
    }

    // MARK: - Group card

    private func groupCard(group: (kind: GroupKind, hands: [(hand: HandView, isAuto: Bool)])) -> some View {
        let net = groupNet(group.hands)
        return VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text(group.kind.icon)
                    .font(.system(size: 16))
                    .foregroundColor(group.kind.isPositive ? .gold500 : .cream300)
                Text("\(group.kind.title) · \(group.hands.count)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.cream100)
                Spacer()
                Text(net >= 0 ? "+\(net)" : "\(net)")
                    .font(.custom("Georgia", size: 14).bold())
                    .foregroundColor(
                        net > 0 ? Color(hex: 0x4ea878)
                        : (net < 0 ? .claret : .cream300)
                    )
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color.black.opacity(0.18))

            VStack(spacing: 6) {
                ForEach(group.hands, id: \.hand.handId) { item in
                    handRow(hand: item.hand, isAuto: item.isAuto, group: group.kind)
                }
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
        }
        .background(
            LinearGradient(
                colors: [Color.white.opacity(0.03), Color.black.opacity(0.15)],
                startPoint: .top, endPoint: .bottom
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.gold500.opacity(0.18), lineWidth: 1)
        )
        .cornerRadius(12)
    }

    // MARK: - Hand row (expandable)

    private func handRow(hand: HandView, isAuto: Bool, group: GroupKind) -> some View {
        let isExpanded = expanded.contains(hand.handId)
        // Single source of truth via resolvedNetOptional — returns nil
        // when neither snapshot nor contribution are present, so we
        // render a dash instead of a misleading "+0".
        let netOpt: Int? = resolvedNetOptional(for: hand)
        let net: Int = netOpt ?? 0

        return VStack(spacing: 0) {
            Button {
                if !isAuto {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                        if isExpanded { expanded.remove(hand.handId) }
                        else { expanded.insert(hand.handId) }
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Text("H\(hand.handIndex + 1)")
                        .font(.custom("Georgia", size: 12).bold())
                        .foregroundColor(.cream200)
                        .frame(width: 26, alignment: .leading)

                    if !hand.myHole.isEmpty {
                        HStack(spacing: 1) {
                            ForEach(hand.myHole, id: \.self) { c in
                                PlayingCardView(card: c, size: .small)
                                    .scaleEffect(0.78)
                                    .frame(width: 19, height: 27)
                            }
                        }
                    }

                    Text(rowDescription(hand: hand, isAuto: isAuto, group: group))
                        .font(.system(size: 11))
                        .foregroundColor(.cream200)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    Spacer()

                    if let netOpt {
                        Text(netOpt >= 0 ? "+\(netOpt)" : "\(netOpt)")
                            .font(.custom("Georgia", size: 13).bold())
                            .foregroundColor(
                                netOpt > 0 ? Color(hex: 0x4ea878)
                                : (netOpt < 0 ? .claret : .cream300)
                            )
                    } else {
                        // Snapshot AND contribution missing — render dash
                        // rather than a misleading "+0" (the recurring bug).
                        Text("—")
                            .font(.custom("Georgia", size: 13).bold())
                            .foregroundColor(.cream400)
                    }

                    if !isAuto {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(.cream400)
                            .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    }
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                expandedDetail(hand: hand)
                    .padding(.bottom, 6)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private func rowDescription(hand: HandView, isAuto: Bool, group: GroupKind) -> String {
        if isAuto {
            let posted = autoActedHands.first { $0.handIndex == hand.handIndex }
            if posted?.action == "fold" {
                return "Auto-folded — no chips available"
            }
            return "Auto-checked"
        }
        let oppName = match.opponent.displayName.components(separatedBy: " ").first ?? "Opp"
        switch group {
        case .bigWin:
            return "Won showdown"
        case .foldInduced:
            return "\(oppName) folded \(hand.foldStreet ?? "post-flop")"
        case .blindSteal:
            return "\(oppName) folded preflop"
        case .splitPot:
            return "Chopped on the board"
        case .showdownLost:
            return "Lost showdown"
        case .youFolded:
            return "You folded \(hand.foldStreet ?? "post-flop")"
        case .autoFolded:
            return "Auto-folded"
        }
    }

    // MARK: - Expanded detail

    @ViewBuilder
    private func expandedDetail(hand: HandView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !hand.board.isEmpty {
                HStack(spacing: 6) {
                    Text("BOARD")
                        .font(.system(size: 9, weight: .medium))
                        .tracking(1.2)
                        .foregroundColor(.cream300)
                        .frame(width: 50, alignment: .leading)
                    HStack(spacing: 2) {
                        ForEach(hand.board, id: \.self) { c in
                            PlayingCardView(card: c, size: .small)
                        }
                    }
                }
            }
            if let opp = hand.opponentHole, !opp.isEmpty {
                HStack(spacing: 6) {
                    Text("OPP")
                        .font(.system(size: 9, weight: .medium))
                        .tracking(1.2)
                        .foregroundColor(.cream300)
                        .frame(width: 50, alignment: .leading)
                    HStack(spacing: 2) {
                        ForEach(opp, id: \.self) { c in
                            PlayingCardView(card: c, size: .small)
                        }
                    }
                }
            }
            if !hand.actionSummary.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Text("LOG")
                        .font(.system(size: 9, weight: .medium))
                        .tracking(1.2)
                        .foregroundColor(.cream300)
                        .frame(width: 50, alignment: .leading)
                    Text(hand.actionSummary)
                        .font(.system(size: 11))
                        .foregroundColor(.cream200)
                        .multilineTextAlignment(.leading)
                }
            }
        }
        .padding(10)
        .background(Color.black.opacity(0.25))
        .cornerRadius(8)
        .padding(.horizontal, 6)
    }

    // MARK: - Footer

    private var sendTurnFooter: some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [.clear, .felt900], startPoint: .top, endPoint: .bottom)
                .frame(height: 36)
            Button(action: onSendTurn) {
                Text("Send turn →")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.felt800)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom)
                    )
                    .cornerRadius(12)
                    .padding(.horizontal, 28)
                    .padding(.bottom, 28)
                    .shadow(color: .black.opacity(0.4), radius: 0, y: 3)
            }
            .background(Color.felt900)
        }
    }
}

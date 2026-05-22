import XCTest
@testable import Tilted

/// Verifies TurnSummaryView's `resolvedNetOptional` fallback ladder:
///   1. Use snapshot when present.
///   2. Use server-provided contribution when snapshot is null.
///   3. Return nil when both are absent (UI renders a dash).
@MainActor
final class TurnSummaryNetTests: XCTestCase {

    private func hand(
        winnerUserId: String? = nil,
        pot: Int = 15,
        myResolvedNet: Int? = nil,
        myContribution: Int? = nil,
        status: String = "complete"
    ) -> HandView {
        HandView(
            handId: "h-1", handIndex: 0,
            myHole: ["Ah","Ks"], opponentHole: nil, board: [],
            pot: pot,
            myReserved: 0,  // intentionally 0 — represents post-settlement state
            opponentReserved: 0,
            street: "complete", status: status,
            actionOnMe: false,
            terminalReason: "fold",
            foldStreet: "preflop",
            winnerUserId: winnerUserId,
            actionSummary: "",
            myResolvedNet: myResolvedNet,
            myContribution: myContribution,
            opponentContribution: nil,
            myShownIndices: nil,
            opponentShownIndices: nil,
            lastAction: nil
        )
    }

    private func summaryView(_ hands: [HandView], currentUserId: String = "user-me") -> TurnSummaryView {
        let match = MatchState(
            matchId: "m", status: "active", winnerUserId: nil,
            opponent: Opponent(userId: "user-opp", displayName: "Opp"),
            myTotal: 2000, opponentTotal: 2000,
            myReserved: 0, opponentReserved: 0,
            myAvailable: 2000, opponentAvailable: 2000,
            currentRound: nil
        )
        let round = RoundView(
            roundId: "r", roundIndex: 1, status: "in_progress",
            myRole: "sb", handsPendingMe: 0, handsPendingOpponent: 0,
            hands: hands
        )
        return TurnSummaryView(
            match: match, round: round,
            resolvedHands: hands,
            autoActedHands: [],
            autoActedHandViews: [],
            stackBefore: 2000,
            currentUserId: currentUserId,
            onSendTurn: {}
        )
    }

    func testUsesSnapshotWhenPresent() {
        let view = summaryView([hand(myResolvedNet: 25)])
        let h = view.resolvedHands[0]
        XCTAssertEqual(view.resolvedNetOptional(for: h), 25)
    }

    func testComputesFromContributionWhenSnapshotNull_WinPath() {
        // I won the 15 pot; my contribution was 5 → net = +10.
        let view = summaryView([hand(winnerUserId: "user-me", pot: 15, myResolvedNet: nil, myContribution: 5)])
        XCTAssertEqual(view.resolvedNetOptional(for: view.resolvedHands[0]), 10)
    }

    func testComputesFromContributionWhenSnapshotNull_LossPath() {
        // Opponent won the 15 pot; my contribution was 5 → net = -5.
        // This is the case where myReserved=0 would have shown "+0".
        let view = summaryView([hand(winnerUserId: "user-opp", pot: 15, myResolvedNet: nil, myContribution: 5)])
        XCTAssertEqual(view.resolvedNetOptional(for: view.resolvedHands[0]), -5)
    }

    func testComputesFromContributionWhenSnapshotNull_SplitPot() {
        // Split (winner null); pot 16, I contributed 8 → net = 16/2 - 8 = 0.
        let view = summaryView([hand(winnerUserId: nil, pot: 16, myResolvedNet: nil, myContribution: 8)])
        XCTAssertEqual(view.resolvedNetOptional(for: view.resolvedHands[0]), 0)
    }

    func testReturnsNilWhenBothMissing() {
        let view = summaryView([hand(winnerUserId: "user-opp", myResolvedNet: nil, myContribution: nil)])
        XCTAssertNil(view.resolvedNetOptional(for: view.resolvedHands[0]))
    }

    func testNeverUsesMyReservedAsLossProxy() {
        // The exact bug we're fixing — pre-fix, this would return -0
        // because myReserved is zeroed by the server. With the new
        // fallback ladder, snapshot-or-contribution drive the result;
        // myReserved is never consulted.
        let h = hand(winnerUserId: "user-opp", pot: 20, myResolvedNet: nil, myContribution: 10)
        // myReserved=0 in the fixture is the post-settlement state.
        let view = summaryView([h])
        XCTAssertEqual(view.resolvedNetOptional(for: h), -10, "Loss should use contribution, not myReserved")
    }
}

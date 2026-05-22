import XCTest
@testable import Tilted

final class HandViewExtensionTests: XCTestCase {

    // MARK: - Fixtures

    private func hand(
        street: String = "preflop",
        status: String = "in_progress",
        actionOnMe: Bool = true,
        myReserved: Int = 5,
        opponentReserved: Int = 10,
        winnerUserId: String? = nil,
        terminalReason: String? = nil
    ) -> HandView {
        HandView(
            handId: "h-test",
            handIndex: 0,
            myHole: ["Ah", "Ks"],
            opponentHole: nil,
            board: [],
            pot: 15,
            myReserved: myReserved,
            opponentReserved: opponentReserved,
            street: street,
            status: status,
            actionOnMe: actionOnMe,
            terminalReason: terminalReason,
            foldStreet: nil,
            winnerUserId: winnerUserId,
            actionSummary: "",
            myResolvedNet: nil,
            myContribution: nil,
            opponentContribution: nil,
            myShownIndices: nil,
            opponentShownIndices: nil,
            lastAction: nil
        )
    }

    // MARK: - isPendingAction

    func testIsPendingActionTrueWhenInProgressAndActionOnMe() {
        XCTAssertTrue(hand(status: "in_progress", actionOnMe: true).isPendingAction)
    }

    func testIsPendingActionFalseWhenComplete() {
        XCTAssertFalse(hand(status: "complete", actionOnMe: true).isPendingAction)
    }

    func testIsPendingActionFalseWhenActionOnOpponent() {
        XCTAssertFalse(hand(status: "in_progress", actionOnMe: false).isPendingAction)
    }

    // MARK: - isTerminal

    func testIsTerminalForCompleteAndRunout() {
        XCTAssertTrue(hand(status: "complete").isTerminal)
        XCTAssertTrue(hand(status: "awaiting_runout").isTerminal)
        XCTAssertFalse(hand(status: "in_progress").isTerminal)
    }

    // MARK: - facingBet / callCost

    func testFacingBetTrueWhenOpponentHasMoreReserved() {
        let h = hand(myReserved: 5, opponentReserved: 10)
        XCTAssertTrue(h.facingBet)
        XCTAssertEqual(h.callCost, 5)
    }

    func testFacingBetFalseWhenReservedEqual() {
        let h = hand(myReserved: 10, opponentReserved: 10)
        XCTAssertFalse(h.facingBet)
        XCTAssertEqual(h.callCost, 0)
    }

    func testCallCostClampedAtZero() {
        // If I have more reserved than opponent (e.g., I bet), I'm not
        // facing a bet — callCost should be 0, not negative.
        let h = hand(myReserved: 100, opponentReserved: 20)
        XCTAssertFalse(h.facingBet)
        XCTAssertEqual(h.callCost, 0)
    }
}

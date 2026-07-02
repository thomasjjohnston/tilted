import XCTest
@testable import Tilted

// Covers the viewer-scoped outcome helper that the round summary, history
// list, and hand detail all share — so a hand you lost can never read as a
// win (beta feedback S7-2), amounts are net not raw pot (S7-3), and folds
// carry street granularity (S7-6).
final class HandOutcomeTests: XCTestCase {
    private let me = "me-123"
    private let opp = "opp-456"

    func testShowdownWinIsWinForWinnerAndLossForLoser() {
        let asWinner = HandOutcome.make(
            terminalReason: "showdown", foldStreet: nil, winnerUserId: me,
            currentUserId: me, myResolvedNet: 240, status: "complete")
        XCTAssertEqual(asWinner.result, .won)
        XCTAssertEqual(asWinner.label, "Won at showdown")
        XCTAssertEqual(asWinner.netText, "+240")

        // Same hand from the loser's perspective must NOT read as a win.
        let asLoser = HandOutcome.make(
            terminalReason: "showdown", foldStreet: nil, winnerUserId: me,
            currentUserId: opp, myResolvedNet: -240, status: "complete")
        XCTAssertEqual(asLoser.result, .lost)
        XCTAssertEqual(asLoser.label, "Lost at showdown")
        XCTAssertEqual(asLoser.netText, "\u{2212}240")
    }

    func testFoldStreetGranularity() {
        // I folded the river.
        let iFolded = HandOutcome.make(
            terminalReason: "fold", foldStreet: "river", winnerUserId: opp,
            currentUserId: me, myResolvedNet: -120, status: "complete")
        XCTAssertEqual(iFolded.result, .lost)
        XCTAssertEqual(iFolded.label, "Folded the river")

        // Opponent folded preflop → I won on blinds.
        let wonBlinds = HandOutcome.make(
            terminalReason: "fold", foldStreet: "preflop", winnerUserId: me,
            currentUserId: me, myResolvedNet: 10, status: "complete")
        XCTAssertEqual(wonBlinds.result, .won)
        XCTAssertEqual(wonBlinds.label, "Won on blinds")
    }

    func testSplitPot() {
        let split = HandOutcome.make(
            terminalReason: "showdown", foldStreet: nil, winnerUserId: nil,
            currentUserId: me, myResolvedNet: 0, status: "complete")
        XCTAssertEqual(split.result, .split)
        XCTAssertEqual(split.label, "Split pot")
    }

    func testNoSnapshotHasNoAmount() {
        // Legacy row with no net snapshot: show the label, never "+0".
        let outcome = HandOutcome.make(
            terminalReason: "fold", foldStreet: "turn", winnerUserId: opp,
            currentUserId: me, myResolvedNet: nil, status: "complete")
        XCTAssertEqual(outcome.label, "Folded the turn")
        XCTAssertNil(outcome.netText)
    }
}

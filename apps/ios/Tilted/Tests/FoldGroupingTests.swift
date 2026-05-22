import XCTest
@testable import Tilted

final class FoldGroupingTests: XCTestCase {
    private let me = "user-me"
    private let opp = "user-opp"

    private func hand(
        id: String,
        foldStreet: String?,
        myResolvedNet: Int? = nil,
        myContribution: Int? = nil,
        winnerUserId: String? = nil,
        status: String = "complete",
        terminalReason: String? = "fold"
    ) -> HandView {
        HandView(
            handId: id, handIndex: 0,
            myHole: [], opponentHole: nil, board: [],
            pot: 15, myReserved: 0, opponentReserved: 0,
            street: "complete", status: status,
            actionOnMe: false,
            terminalReason: terminalReason,
            foldStreet: foldStreet,
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

    func testIdenticalPreflopFoldsGroup() {
        let h1 = hand(id: "h1", foldStreet: "preflop", myResolvedNet: -5, winnerUserId: opp)
        let h2 = hand(id: "h2", foldStreet: "preflop", myResolvedNet: -5, winnerUserId: opp)
        let h3 = hand(id: "h3", foldStreet: "preflop", myResolvedNet: -5, winnerUserId: opp)
        let groups = FoldGrouper.group([h1, h2, h3], currentUserId: me)
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].map(\.handId), ["h1", "h2", "h3"])
    }

    func testDifferentLossPreflopFoldsDontGroup() {
        let h1 = hand(id: "h1", foldStreet: "preflop", myResolvedNet: -5, winnerUserId: opp)
        let h2 = hand(id: "h2", foldStreet: "preflop", myResolvedNet: -10, winnerUserId: opp)
        let groups = FoldGrouper.group([h1, h2], currentUserId: me)
        XCTAssertEqual(groups.count, 2)
    }

    func testFlopFoldsNeverGroup() {
        let h1 = hand(id: "h1", foldStreet: "flop", myResolvedNet: -50, winnerUserId: opp)
        let h2 = hand(id: "h2", foldStreet: "flop", myResolvedNet: -50, winnerUserId: opp)
        let groups = FoldGrouper.group([h1, h2], currentUserId: me)
        XCTAssertEqual(groups.count, 2, "Postflop folds always get their own screen")
    }

    func testMixOfPreflopAndPostflopFolds() {
        let pre1 = hand(id: "p1", foldStreet: "preflop", myResolvedNet: -5, winnerUserId: opp)
        let pre2 = hand(id: "p2", foldStreet: "preflop", myResolvedNet: -5, winnerUserId: opp)
        let flop1 = hand(id: "f1", foldStreet: "flop", myResolvedNet: -40, winnerUserId: opp)
        let groups = FoldGrouper.group([pre1, flop1, pre2], currentUserId: me)
        // Two preflop folds match — they group even though a flop fold
        // is interleaved. Flop fold is its own group.
        XCTAssertEqual(groups.count, 2)
        let preflopGroup = groups.first { $0.count == 2 }
        XCTAssertNotNil(preflopGroup)
        XCTAssertEqual(preflopGroup!.map(\.handId), ["p1", "p2"])
    }

    func testWinsAndShowdownsAreSingletons() {
        let win = hand(id: "w", foldStreet: "preflop", myResolvedNet: 5, winnerUserId: me)
        let showdown = hand(id: "s", foldStreet: nil, myResolvedNet: 100, winnerUserId: me, terminalReason: "showdown")
        let groups = FoldGrouper.group([win, showdown], currentUserId: me)
        XCTAssertEqual(groups.count, 2)
        XCTAssertEqual(groups[0].count, 1)
        XCTAssertEqual(groups[1].count, 1)
    }

    func testFallsBackToContributionWhenSnapshotMissing() {
        let h1 = hand(id: "h1", foldStreet: "preflop", myResolvedNet: nil, myContribution: 5, winnerUserId: opp)
        let h2 = hand(id: "h2", foldStreet: "preflop", myResolvedNet: nil, myContribution: 5, winnerUserId: opp)
        let groups = FoldGrouper.group([h1, h2], currentUserId: me)
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].count, 2)
    }
}

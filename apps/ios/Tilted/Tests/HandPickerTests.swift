import XCTest
@testable import Tilted

final class HandPickerTests: XCTestCase {

    private func hand(
        handIndex: Int,
        street: String = "preflop",
        actionOnMe: Bool = true,
        status: String = "in_progress"
    ) -> HandView {
        HandView(
            handId: "h-\(handIndex)-\(street)",
            handIndex: handIndex,
            myHole: [],
            opponentHole: nil,
            board: [],
            pot: 0,
            myReserved: 0,
            opponentReserved: 0,
            street: street,
            status: status,
            actionOnMe: actionOnMe,
            terminalReason: nil,
            foldStreet: nil,
            winnerUserId: nil,
            actionSummary: "",
            myResolvedNet: nil,
            myContribution: nil,
            opponentContribution: nil,
            myShownIndices: nil,
            opponentShownIndices: nil,
            lastAction: nil
        )
    }

    func testStreetOrderOrdering() {
        XCTAssertEqual(hand(handIndex: 0, street: "preflop").streetOrder, 0)
        XCTAssertEqual(hand(handIndex: 0, street: "flop").streetOrder, 1)
        XCTAssertEqual(hand(handIndex: 0, street: "turn").streetOrder, 2)
        XCTAssertEqual(hand(handIndex: 0, street: "river").streetOrder, 3)
    }

    func testPicksLowestStreetThenLowestHandIndex() {
        let current = hand(handIndex: 0, street: "preflop")
        // Mixed pending: a flop hand and two more preflop hands.
        let pending = [
            hand(handIndex: 0, street: "preflop"),  // = current
            hand(handIndex: 1, street: "flop"),
            hand(handIndex: 2, street: "preflop"),
            hand(handIndex: 3, street: "preflop"),
        ]
        let result = HandPicker.nextHand(after: current, in: pending)
        XCTAssertEqual(result.next?.handIndex, 2)
        XCTAssertEqual(result.next?.street, "preflop")
        XCTAssertNil(result.crossedToStreet, "Same-street pick should not flag a wave crossing")
    }

    func testFlagsWaveCrossingWhenAdvancingStreet() {
        let current = hand(handIndex: 5, street: "preflop")
        // No more preflop pending; first flop hand should be picked
        // with crossedToStreet == "flop".
        let pending = [
            hand(handIndex: 5, street: "preflop"),  // = current
            hand(handIndex: 0, street: "flop"),
            hand(handIndex: 3, street: "flop"),
        ]
        let result = HandPicker.nextHand(after: current, in: pending)
        XCTAssertEqual(result.next?.handIndex, 0)
        XCTAssertEqual(result.next?.street, "flop")
        XCTAssertEqual(result.crossedToStreet, "flop")
    }

    func testReturnsNilWhenNoOtherPending() {
        let current = hand(handIndex: 0, street: "preflop")
        let result = HandPicker.nextHand(after: current, in: [current])
        XCTAssertNil(result.next)
        XCTAssertNil(result.crossedToStreet)
    }

    func testIgnoresHandsThatArentPending() {
        let current = hand(handIndex: 0, street: "preflop")
        let pending = [
            current,
            hand(handIndex: 1, street: "preflop", actionOnMe: false),       // waiting on opp
            hand(handIndex: 2, street: "preflop", status: "complete"),      // resolved
            hand(handIndex: 3, street: "preflop"),                          // <-- this one
        ]
        let result = HandPicker.nextHand(after: current, in: pending)
        XCTAssertEqual(result.next?.handIndex, 3)
    }
}

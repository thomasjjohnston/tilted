import XCTest
@testable import Tilted

@MainActor
final class AppStoreTests: XCTestCase {

    override func setUp() {
        super.setUp()
        // AppStore loads seenCompletions from UserDefaults on init —
        // wipe between tests so prior runs don't leak state.
        UserDefaults.standard.removeObject(forKey: "tilted.seenCompletions")
    }

    // MARK: - Fixtures

    private func makeMatch(matchId: String, myTotal: Int = 2000) -> MatchState {
        MatchState(
            matchId: matchId,
            status: "active",
            winnerUserId: nil,
            opponent: Opponent(userId: "opp", displayName: "Opp"),
            myTotal: myTotal,
            opponentTotal: 2000,
            myReserved: 0,
            opponentReserved: 0,
            myAvailable: myTotal,
            opponentAvailable: 2000,
            currentRound: nil
        )
    }

    // MARK: - spliceMatch

    func testSpliceReplacesExistingMatchInPlace() {
        let store = AppStore()
        let original = makeMatch(matchId: "m-1", myTotal: 2000)
        store.matches = [original]

        let updated = makeMatch(matchId: "m-1", myTotal: 1500)
        store.spliceMatch(updated)

        XCTAssertEqual(store.matches.count, 1)
        XCTAssertEqual(store.matches[0].myTotal, 1500)
    }

    func testSpliceInsertsAtFrontIfMatchNotPresent() {
        let store = AppStore()
        let existing = makeMatch(matchId: "m-2")
        store.matches = [existing]

        let fresh = makeMatch(matchId: "m-3")
        store.spliceMatch(fresh)

        XCTAssertEqual(store.matches.count, 2)
        XCTAssertEqual(store.matches[0].matchId, "m-3")
        XCTAssertEqual(store.matches[1].matchId, "m-2")
    }

    func testSplicePreservesOrderOfOtherMatches() {
        let store = AppStore()
        let m1 = makeMatch(matchId: "m-1", myTotal: 2000)
        let m2 = makeMatch(matchId: "m-2", myTotal: 2000)
        let m3 = makeMatch(matchId: "m-3", myTotal: 2000)
        store.matches = [m1, m2, m3]

        let updated2 = makeMatch(matchId: "m-2", myTotal: 999)
        store.spliceMatch(updated2)

        XCTAssertEqual(store.matches.map(\.matchId), ["m-1", "m-2", "m-3"])
        XCTAssertEqual(store.matches[1].myTotal, 999)
    }

    // MARK: - Completion queue

    private func resolvedHand(handId: String, handIndex: Int = 0) -> HandView {
        HandView(
            handId: handId,
            handIndex: handIndex,
            myHole: ["Ah", "Ks"], opponentHole: nil, board: [],
            pot: 100, myReserved: 0, opponentReserved: 0,
            street: "complete", status: "complete",
            actionOnMe: false,
            terminalReason: "fold",
            foldStreet: "preflop",
            winnerUserId: "user-me",
            actionSummary: "",
            myResolvedNet: 5,
            myContribution: nil,
            opponentContribution: nil,
            myShownIndices: nil,
            opponentShownIndices: nil,
            lastAction: nil
        )
    }

    func testAcknowledgeCompletionMovesHandFromQueueToSeen() {
        let store = AppStore()
        let h1 = resolvedHand(handId: "h-1")
        let h2 = resolvedHand(handId: "h-2")
        store.unseenCompletions = [h1, h2]
        XCTAssertFalse(store.seenCompletions.contains("h-1"))

        store.acknowledgeCompletion("h-1")

        XCTAssertTrue(store.seenCompletions.contains("h-1"))
        XCTAssertEqual(store.unseenCompletions.count, 1)
        XCTAssertEqual(store.unseenCompletions.first?.handId, "h-2")
    }

    func testMarkCompletionSeenInsertsButDoesNotMutateQueue() {
        // Used by the in-turn flow when the user just resolved a hand
        // themselves; the queue shouldn't be touched (it only carries
        // *retroactive* completions surfaced by HomeView).
        let store = AppStore()
        let h = resolvedHand(handId: "h-1")
        store.unseenCompletions = [h]

        store.markCompletionSeen("h-1")

        XCTAssertTrue(store.seenCompletions.contains("h-1"))
        XCTAssertEqual(store.unseenCompletions.count, 1, "markCompletionSeen shouldn't pop the queue")
    }
}

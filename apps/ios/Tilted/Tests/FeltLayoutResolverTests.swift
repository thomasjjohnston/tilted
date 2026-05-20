import XCTest
@testable import Tilted

final class FeltLayoutResolverTests: XCTestCase {

    func testUserSB_OpponentBB_DealerButtonOnUserSide() {
        let layout = FeltLayoutResolver.resolve(isBB: false)
        XCTAssertFalse(layout.oppHasDealer)
        XCTAssertEqual(layout.oppChip, .bb)
        XCTAssertTrue(layout.userHasDealer)
        XCTAssertEqual(layout.userChip, .sb)
    }

    func testUserBB_OpponentSB_DealerButtonOnOpponentSide() {
        let layout = FeltLayoutResolver.resolve(isBB: true)
        XCTAssertTrue(layout.oppHasDealer)
        XCTAssertEqual(layout.oppChip, .sb)
        XCTAssertFalse(layout.userHasDealer)
        XCTAssertEqual(layout.userChip, .bb)
    }

    func testDealerAndChipsAreNeverBothOnTheSameSide() {
        for isBB in [false, true] {
            let layout = FeltLayoutResolver.resolve(isBB: isBB)
            // The button is on exactly one side, paired with the SB chip.
            XCTAssertNotEqual(layout.oppHasDealer, layout.userHasDealer,
                              "Dealer button must be on exactly one side (isBB=\(isBB))")
            // The two chips are never the same role.
            XCTAssertNotEqual(layout.oppChip, layout.userChip,
                              "Both sides showing the same blind position is the bug we fixed (isBB=\(isBB))")
        }
    }
}

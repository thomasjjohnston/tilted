import XCTest
@testable import Tilted

/// ShowCardsPickerView is a SwiftUI struct — we can't easily test its
/// view body in pure unit tests, but we can exercise its initialization
/// and confirm the API contract (myHole, alreadyShown).
final class ShowCardsPickerTests: XCTestCase {

    func testInitializesWithoutAlreadyShown() {
        let view = ShowCardsPickerView(
            myHole: ["Ah", "Ks"],
            opponentName: "Sarah",
            onSubmit: { _ in },
            onCancel: {},
            alreadyShown: []
        )
        // Just verify the view constructed; SwiftUI view body assertions
        // aren't well-supported in unit tests, but the picker is small
        // enough that the state transitions are validated by manual
        // smoke testing.
        XCTAssertEqual(view.myHole, ["Ah", "Ks"])
        XCTAssertEqual(view.alreadyShown, [])
    }

    func testInitializesWithAlreadyShown() {
        let view = ShowCardsPickerView(
            myHole: ["Ah", "Ks"],
            opponentName: "Sarah",
            onSubmit: { _ in },
            onCancel: {},
            alreadyShown: [0]
        )
        XCTAssertEqual(view.alreadyShown, [0])
    }
}

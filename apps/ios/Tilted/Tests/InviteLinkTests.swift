import XCTest
@testable import Tilted

final class InviteLinkTests: XCTestCase {

    // MARK: - code(from:)

    func testExtractsCodeFromInviteURL() {
        let url = URL(string: "https://tilted-server.fly.dev/i/ABCD2345")!
        XCTAssertEqual(InviteLink.code(from: url), "ABCD2345")
    }

    func testNormalisesLowercaseCodeInURL() {
        let url = URL(string: "https://tilted-server.fly.dev/i/abcd2345")!
        XCTAssertEqual(InviteLink.code(from: url), "ABCD2345")
    }

    func testIgnoresQueryAndTrailingSlash() {
        let url = URL(string: "https://tilted-server.fly.dev/i/ABCD2345/?utm=x")!
        XCTAssertEqual(InviteLink.code(from: url), "ABCD2345")
    }

    func testRejectsOtherPaths() {
        XCTAssertNil(InviteLink.code(from: URL(string: "https://tilted-server.fly.dev/privacy")!))
        XCTAssertNil(InviteLink.code(from: URL(string: "https://tilted-server.fly.dev/i/")!))
        XCTAssertNil(InviteLink.code(from: URL(string: "https://tilted-server.fly.dev/v1/i/ABCD2345")!))
        XCTAssertNil(InviteLink.code(from: URL(string: "https://tilted-server.fly.dev/i/ABCD2345/extra")!))
    }

    func testRejectsOtherHosts() {
        XCTAssertNil(InviteLink.code(from: URL(string: "https://evil.example.com/i/ABCD2345")!))
    }

    // MARK: - normalize

    func testNormalizeStripsSeparatorsAndUppercases() {
        XCTAssertEqual(InviteLink.normalize(" abcd-2345 "), "ABCD2345")
        XCTAssertEqual(InviteLink.normalize("ab cd 23 45"), "ABCD2345")
    }

    func testIsPlausibleCode() {
        XCTAssertTrue(InviteLink.isPlausible("ABCD2345"))
        XCTAssertTrue(InviteLink.isPlausible("abcd-2345"))
        XCTAssertFalse(InviteLink.isPlausible("ABC"))
        XCTAssertFalse(InviteLink.isPlausible(""))
    }

    // MARK: - share text

    func testShareMessageContainsURL() {
        let msg = InviteLink.shareMessage(url: "https://tilted-server.fly.dev/i/ABCD2345")
        XCTAssertTrue(msg.contains("https://tilted-server.fly.dev/i/ABCD2345"))
    }
}

@MainActor
final class PendingInviteTests: XCTestCase {

    override func setUp() {
        super.setUp()
        UserDefaults.standard.removeObject(forKey: "tilted.seenCompletions")
        UserDefaults.standard.removeObject(forKey: "tilted.pendingInviteCode")
    }

    func testIncomingInviteURLIsQueued() {
        let store = AppStore()
        store.handleIncomingURL(URL(string: "https://tilted-server.fly.dev/i/abcd2345")!)
        XCTAssertEqual(store.pendingInviteCode, "ABCD2345")
    }

    func testNonInviteURLIsIgnored() {
        let store = AppStore()
        store.handleIncomingURL(URL(string: "https://tilted-server.fly.dev/support")!)
        XCTAssertNil(store.pendingInviteCode)
    }

    func testPendingInviteSurvivesRelaunchUntilConsumed() {
        // A friend taps the link before signing in: the code must still be
        // there after the app is relaunched or sign-in completes.
        let first = AppStore()
        first.handleIncomingURL(URL(string: "https://tilted-server.fly.dev/i/ABCD2345")!)

        let relaunched = AppStore()
        XCTAssertEqual(relaunched.pendingInviteCode, "ABCD2345")

        relaunched.consumePendingInvite()
        XCTAssertNil(relaunched.pendingInviteCode)
        XCTAssertNil(AppStore().pendingInviteCode)
    }

    func testSignOutKeepsNoPendingInvite() {
        let store = AppStore()
        store.handleIncomingURL(URL(string: "https://tilted-server.fly.dev/i/ABCD2345")!)
        store.logout()
        XCTAssertNil(store.pendingInviteCode)
    }
}

@MainActor
final class HowToPlayFlagTests: XCTestCase {
    override func setUp() {
        super.setUp()
        UserDefaults.standard.removeObject(forKey: "tilted.seenCompletions")
        UserDefaults.standard.removeObject(forKey: "tilted.hasSeenHowToPlay")
    }

    func testFirstLaunchHasNotSeenHowToPlay() {
        XCTAssertFalse(AppStore().hasSeenHowToPlay)
    }

    func testMarkingSeenPersistsAcrossRelaunch() {
        let store = AppStore()
        store.markHowToPlaySeen()
        XCTAssertTrue(store.hasSeenHowToPlay)
        XCTAssertTrue(AppStore().hasSeenHowToPlay)
    }
}

import XCTest
@testable import Tilted

/// Verifies the chat messages endpoint URL/query string construction.
final class APIClientMessagesTests: XCTestCase {

    func testSendMessageURL() async {
        let client = APIClient.shared
        let url = await client.makeURL(path: "/v1/match/m-1/messages")
        XCTAssertEqual(url.absoluteString, "https://tilted-server.fly.dev/v1/match/m-1/messages")
    }

    func testListMessagesURL_NoFilters() async {
        let client = APIClient.shared
        let url = await client.makeURL(path: "/v1/match/m-1/messages")
        XCTAssertNil(url.query)
    }

    func testListMessagesURL_HandIdFilter() async {
        let client = APIClient.shared
        let url = await client.makeURL(path: "/v1/match/m-1/messages", query: ["hand_id": "h-1"])
        XCTAssertEqual(url.absoluteString, "https://tilted-server.fly.dev/v1/match/m-1/messages?hand_id=h-1")
    }

    func testListMessagesURL_AllFilters() async {
        let client = APIClient.shared
        let url = await client.makeURL(path: "/v1/match/m-1/messages", query: [
            "hand_id": "h-1",
            "cursor": "2026-05-22T13:00:00Z",
            "limit": "50",
        ])
        // makeURL sorts keys alphabetically.
        XCTAssertEqual(url.query, "cursor=2026-05-22T13:00:00Z&hand_id=h-1&limit=50")
    }
}

import XCTest
@testable import Tilted

final class APIClientURLTests: XCTestCase {

    func testPathOnlyURL() async {
        let client = APIClient.shared
        let url = await client.makeURL(path: "/v1/me")
        XCTAssertEqual(url.absoluteString, "https://tilted-server.fly.dev/v1/me")
    }

    func testSingleQueryParam() async {
        let client = APIClient.shared
        let url = await client.makeURL(path: "/v1/history", query: ["favorites": "true"])
        XCTAssertEqual(url.absoluteString, "https://tilted-server.fly.dev/v1/history?favorites=true")
    }

    func testMultipleQueryParamsAreAlphabeticallyOrdered() async {
        // Stability matters because URLs hit upstream caches and we want
        // deterministic test fixtures.
        let client = APIClient.shared
        let url = await client.makeURL(path: "/v1/history", query: ["result": "won", "favorites": "true"])
        XCTAssertEqual(url.absoluteString, "https://tilted-server.fly.dev/v1/history?favorites=true&result=won")
    }

    func testQueryValuesArePercentEncoded() async {
        let client = APIClient.shared
        let url = await client.makeURL(path: "/v1/matchup", query: ["q": "tilted & friends"])
        // " " → %20, "&" → %26
        XCTAssertEqual(url.query, "q=tilted%20%26%20friends")
    }

    func testEmptyQueryProducesNoQueryString() async {
        let client = APIClient.shared
        let url = await client.makeURL(path: "/v1/history", query: [:])
        XCTAssertNil(url.query)
    }
}

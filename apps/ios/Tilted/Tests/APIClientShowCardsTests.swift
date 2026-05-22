import XCTest
@testable import Tilted

/// Verifies the show-cards endpoint URL/body. The Tilted client builds
/// the URL via makeURL; here we just spot-check it produces the right
/// shape for the show endpoint.
final class APIClientShowCardsTests: XCTestCase {

    func testShowCardsURL() async {
        let client = APIClient.shared
        let url = await client.makeURL(path: "/v1/hand/abc-123/show")
        XCTAssertEqual(url.absoluteString, "https://tilted-server.fly.dev/v1/hand/abc-123/show")
    }
}

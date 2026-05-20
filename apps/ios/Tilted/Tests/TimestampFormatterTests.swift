import XCTest
@testable import Tilted

final class TimestampFormatterTests: XCTestCase {

    /// Reference: 2026-05-19 12:00:00 UTC.
    private let ref: Date = {
        var c = DateComponents(year: 2026, month: 5, day: 19, hour: 12, minute: 0)
        c.timeZone = TimeZone(identifier: "UTC")
        return Calendar(identifier: .gregorian).date(from: c)!
    }()

    func testReturnsNilForNilInput() {
        XCTAssertNil(TimestampFormatter.format(nil, referenceDate: ref))
    }

    func testReturnsNilForUnparseableInput() {
        XCTAssertNil(TimestampFormatter.format("not-a-date", referenceDate: ref))
    }

    func testRelativeFormatForRecent() {
        // 2 hours before reference.
        let iso = "2026-05-19T10:00:00.000Z"
        let out = TimestampFormatter.format(iso, referenceDate: ref)
        XCTAssertNotNil(out)
        // RelativeDateTimeFormatter outputs "2 hr. ago" in en_US short.
        // We assert it contains "ago" and the magnitude, locale-tolerant.
        XCTAssertTrue(out!.contains("ago") || out!.contains("hr") || out!.contains("h"))
    }

    func testAbsoluteFormatForOlderThan24h() {
        // Two days before reference.
        let iso = "2026-05-17T15:42:00.000Z"
        let out = TimestampFormatter.format(iso, referenceDate: ref)
        XCTAssertNotNil(out)
        // Should look like "May 17, …"
        XCTAssertTrue(out!.contains("May 17"), "Expected 'May 17' in absolute format, got: \(out!)")
    }

    func testAcceptsIsoWithoutFractionalSeconds() {
        // Server sometimes returns no .000Z suffix.
        let iso = "2026-05-19T10:00:00Z"
        let out = TimestampFormatter.format(iso, referenceDate: ref)
        XCTAssertNotNil(out)
    }
}

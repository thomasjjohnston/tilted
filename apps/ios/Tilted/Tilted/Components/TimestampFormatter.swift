import Foundation

/// Formats ISO-8601 timestamps for the user-facing UI.
/// - Hands resolved within the last 24 hours → relative ("2h ago").
/// - Older hands → absolute date + time ("May 18, 3:42 PM").
enum TimestampFormatter {
    /// Returns nil if the input is nil or unparseable.
    /// `referenceDate` is injectable for tests.
    static func format(_ iso: String?, referenceDate: Date = Date()) -> String? {
        guard let iso, let date = parse(iso) else { return nil }
        let interval = referenceDate.timeIntervalSince(date)
        if interval < 86_400 && interval >= -60 {
            return relativeFormatter.localizedString(for: date, relativeTo: referenceDate)
        }
        return absoluteFormatter.string(from: date)
    }

    private static func parse(_ iso: String) -> Date? {
        // ISO8601 with fractional seconds (Postgres / drizzle default).
        if let d = isoWithFractional.date(from: iso) { return d }
        // Fallback without fractional seconds.
        if let d = isoWithoutFractional.date(from: iso) { return d }
        return nil
    }

    private static let isoWithFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoWithoutFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()

    private static let absoluteFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMM d, h:mm a"
        return f
    }()
}

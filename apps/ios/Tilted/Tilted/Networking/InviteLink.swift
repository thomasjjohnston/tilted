import Foundation

/// Parsing and formatting for invite links and codes (spec §25).
/// Pure helpers: the server is the authority on whether a code is valid.
enum InviteLink {
    /// Hosts whose `/i/<code>` links belong to the app. Must match the
    /// Associated Domains entitlement in project.yml.
    static let hosts: Set<String> = ["tilted-server.fly.dev"]

    /// Shortest thing worth sending to the server as a code.
    static let minimumLength = 6

    /// The invite code in a universal link, or nil if the URL isn't one.
    static func code(from url: URL) -> String? {
        guard let host = url.host?.lowercased(), hosts.contains(host) else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 2, parts[0] == "i" else { return nil }
        let code = normalize(parts[1])
        return code.isEmpty ? nil : code
    }

    /// Accept what people type or paste: lowercase, spaces, dashes.
    static func normalize(_ raw: String) -> String {
        String(raw.uppercased().unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0) && $0.isASCII
        })
    }

    static func isPlausible(_ raw: String) -> Bool {
        normalize(raw).count >= minimumLength
    }

    /// Text placed in the share sheet alongside the link.
    static func shareMessage(url: String) -> String {
        "Play me at Tilted: heads-up poker, ten hands at once off one stack. \(url)"
    }
}

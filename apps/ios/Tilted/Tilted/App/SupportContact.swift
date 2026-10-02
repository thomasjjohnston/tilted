import Foundation

/// The one contact address for Tilted: feedback, support, privacy requests.
/// Keep in sync with the server-hosted support and privacy pages.
enum SupportContact {
    static let email = "tilted.admin@gmail.com"
    /// Public pages served by the API host (apps/server/src/web).
    static let privacyPolicyURL = URL(string: "https://tilted-server.fly.dev/privacy")!
    static let supportURL = URL(string: "https://tilted-server.fly.dev/support")!
}

#if DEBUG
import Foundation

/// Launch arguments for driving a Debug build on the simulator without
/// touching the screen: local verification and screenshots. None of this
/// exists in Release builds. See docs/LOCAL-TESTING.md.
///
///   -debugUserId <uuid>     sign in through the local-only debug route
///   -debug_server_url <url> point at a local server (read by APIClient)
///   -debugScreen <name>     open a screen at launch: newGame, blocked
enum DebugLaunch {
    static var userId: String? { UserDefaults.standard.string(forKey: "debugUserId") }
    static var screen: String? { UserDefaults.standard.string(forKey: "debugScreen") }
    /// Automated launches shouldn't stall on the system push-permission alert.
    static var isAutomated: Bool { userId != nil }
}
#endif

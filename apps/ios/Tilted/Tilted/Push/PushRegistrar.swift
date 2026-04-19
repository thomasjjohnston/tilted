import Foundation
import UIKit
import UserNotifications

extension Notification.Name {
    static let tiltedDeepLink = Notification.Name("tiltedDeepLink")
}

@Observable
final class PushRegistrar: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushRegistrar()

    var permissionGranted = false
    private weak var store: AppStore?

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func attachStore(_ store: AppStore) {
        self.store = store
    }

    func requestPermission() async {
        do {
            let granted = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound, .badge])
            permissionGranted = granted
            if granted {
                await MainActor.run {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        } catch {
            print("Push permission error: \(error)")
        }
    }

    func handleDeviceToken(_ token: Data) {
        let tokenString = token.map { String(format: "%02.2hhx", $0) }.joined()
        Task {
            try? await APIClient.shared.updateApnsToken(tokenString)
        }
    }

    // Foreground notification presentation
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        return [.banner, .sound]
    }

    // Notification tap
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        let kind = (userInfo["kind"] as? String) ?? ""

        await MainActor.run {
            // All four notification kinds deep-link into Home. HomeView
            // already branches on current match/round state to show the
            // right CTA ("Take your turn", "Watch the reveal", etc).
            store?.selectedTab = .home
            NotificationCenter.default.post(
                name: .tiltedDeepLink,
                object: nil,
                userInfo: ["kind": kind]
            )
        }
        // Refresh off the main thread so the deep-link handler returns fast.
        await store?.refresh()
    }
}

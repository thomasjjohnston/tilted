import SwiftUI
import UIKit

@main
struct TiltedApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var store = AppStore()

    init() {
        configureTabBarAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .task {
                    await PushRegistrar.shared.requestPermission()
                }
                .onAppear {
                    PushRegistrar.shared.attachStore(store)
                }
        }
    }

    private func configureTabBarAppearance() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(Color.felt800.opacity(0.95))

        let normalIcon = UIColor(Color.cream300)
        let selectedIcon = UIColor(Color.gold500)

        appearance.stackedLayoutAppearance.normal.iconColor = normalIcon
        appearance.stackedLayoutAppearance.normal.titleTextAttributes = [.foregroundColor: normalIcon]
        appearance.stackedLayoutAppearance.selected.iconColor = selectedIcon
        appearance.stackedLayoutAppearance.selected.titleTextAttributes = [.foregroundColor: selectedIcon]

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = PushRegistrar.shared
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushRegistrar.shared.handleDeviceToken(deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("APNS registration failed: \(error)")
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        Group {
            if store.isAuthenticated {
                MainTabView()
            } else {
                DebugPickerView()
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            store.checkAuth()
        }
    }
}

struct MainTabView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        @Bindable var bindableStore = store
        TabView(selection: $bindableStore.selectedTab) {
            HomeView()
                .tag(AppStore.Tab.home)
                .tabItem {
                    Image(systemName: "house.fill")
                    Text("Home")
                }
            MatchUpView()
                .tag(AppStore.Tab.matchUp)
                .tabItem {
                    Image(systemName: "person.2.fill")
                    Text("Match-up")
                }
            HistoryView()
                .tag(AppStore.Tab.history)
                .tabItem {
                    Image(systemName: "clock.fill")
                    Text("History")
                }
            SettingsView()
                .tag(AppStore.Tab.settings)
                .tabItem {
                    Image(systemName: "gearshape.fill")
                    Text("Settings")
                }
        }
        .tint(.gold500)
    }
}

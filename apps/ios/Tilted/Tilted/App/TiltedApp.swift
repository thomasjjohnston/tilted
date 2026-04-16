import SwiftUI

@main
struct TiltedApp: App {
    @State private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
        }
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        Group {
            if store.isAuthenticated {
                HomeView()
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

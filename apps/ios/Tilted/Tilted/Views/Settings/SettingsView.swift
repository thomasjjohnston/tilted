import SwiftUI

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @State private var showDeleteConfirm = false
    @State private var deleteError: String?
    #if DEBUG
    @State private var debugServer: String = APIClient.debugServerString
    #endif

    var body: some View {
        NavigationStack {
            ZStack {
                Color.clear.feltBackground().ignoresSafeArea()

                VStack(spacing: 0) {
                    List {
                        Section {
                            Button {
                                openNotificationSettings()
                            } label: {
                                HStack {
                                    Text("Notifications")
                                        .foregroundColor(.cream100)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .foregroundColor(.cream300)
                                        .font(.caption)
                                }
                            }
                        } header: {
                            Text("Preferences")
                                .foregroundColor(.cream300)
                        }
                        .listRowBackground(Color.felt600)

                        Section {
                            NavigationLink {
                                BlockedPlayersView()
                            } label: {
                                Text("Blocked players")
                                    .foregroundColor(.cream100)
                            }
                        } header: {
                            Text("Privacy")
                                .foregroundColor(.cream300)
                        }
                        .listRowBackground(Color.felt600)

                        Section {
                            Link(destination: SupportContact.supportURL) {
                                HStack {
                                    Text("Help & how to play")
                                        .foregroundColor(.cream100)
                                    Spacer()
                                    Image(systemName: "arrow.up.right")
                                        .foregroundColor(.cream300)
                                        .font(.caption)
                                }
                            }
                            Button("Send Feedback") {
                                sendFeedback()
                            }
                            .foregroundColor(.gold500)
                            Link(destination: SupportContact.privacyPolicyURL) {
                                HStack {
                                    Text("Privacy Policy")
                                        .foregroundColor(.cream100)
                                    Spacer()
                                    Image(systemName: "arrow.up.right")
                                        .foregroundColor(.cream300)
                                        .font(.caption)
                                }
                            }
                        } header: {
                            Text("Support")
                                .foregroundColor(.cream300)
                        }
                        .listRowBackground(Color.felt600)

                        Section {
                            Button("Sign Out") {
                                store.logout()
                            }
                            .foregroundColor(.claret)
                            Button("Delete Account") {
                                showDeleteConfirm = true
                            }
                            .foregroundColor(.claret)
                        } header: {
                            Text("Account")
                                .foregroundColor(.cream300)
                        }
                        .listRowBackground(Color.felt600)

                        Section {
                            HStack {
                                Text("Version")
                                    .foregroundColor(.cream100)
                                Spacer()
                                Text(Self.appVersion)
                                    .foregroundColor(.cream300)
                            }

                            if let name = store.currentUserName {
                                HStack {
                                    Text("Signed in as")
                                        .foregroundColor(.cream100)
                                    Spacer()
                                    Text(name)
                                        .foregroundColor(.cream300)
                                }
                            }
                        } header: {
                            Text("About")
                                .foregroundColor(.cream300)
                        }
                        .listRowBackground(Color.felt600)

                        #if DEBUG
                        Section {
                            TextField("http://192.168.x.x:3000", text: $debugServer)
                                .foregroundColor(.cream100)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .keyboardType(.URL)
                            Button("Apply & sign out") {
                                APIClient.applyDebugServer(debugServer)
                                store.logout()
                            }
                            .foregroundColor(.gold500)
                            if !debugServer.isEmpty {
                                Button("Reset to production") {
                                    debugServer = ""
                                    APIClient.applyDebugServer("")
                                    store.logout()
                                }
                                .foregroundColor(.cream300)
                            }
                        } header: {
                            Text("Debug · Server")
                                .foregroundColor(.cream300)
                        } footer: {
                            Text("Point this build at a local server for testing (see docs/LOCAL-TESTING.md). Blank = production. Signs you out so you re-authenticate against the new server.")
                                .foregroundColor(.cream400)
                        }
                        .listRowBackground(Color.felt600)
                        #endif
                    }
                    .scrollContentBackground(.hidden)
                    .listStyle(.insetGrouped)
                }
            }
            #if DEBUG
            .navigationDestination(isPresented: .constant(DebugLaunch.screen == "blocked")) {
                BlockedPlayersView()
            }
            #endif
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Settings")
                        .font(.displaySmall)
                        .fontDesign(.serif)
                        .foregroundColor(.cream100)
                }
            }
            .alert("Delete your account?", isPresented: $showDeleteConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    Task {
                        do {
                            try await store.deleteAccount()
                        } catch {
                            deleteError = error.localizedDescription
                        }
                    }
                }
            } message: {
                Text("This removes your name, email, pinned hands, and Apple sign-in binding, and ends any matches in progress. Hands you played stay in your opponents' history under \"Deleted Player\". You can sign back in later, but nothing will be restored.")
            }
            .alert("Delete failed", isPresented: Binding(
                get: { deleteError != nil },
                set: { if !$0 { deleteError = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(deleteError ?? "")
            }
        }
    }

    /// "1.0.0 (12)" from the bundle, so it never drifts from project.yml.
    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    private func openNotificationSettings() {
        if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    private func sendFeedback() {
        if let url = URL(string: "mailto:\(SupportContact.email)?subject=Tilted%20Feedback") {
            UIApplication.shared.open(url)
        }
    }
}

#Preview {
    SettingsView()
        .environment(AppStore())
}

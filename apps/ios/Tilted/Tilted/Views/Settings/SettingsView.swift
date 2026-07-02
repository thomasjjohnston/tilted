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
                            Button("Send Feedback") {
                                sendFeedback()
                            }
                            .foregroundColor(.gold500)
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
                                Text("0.1.0")
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
                Text("This removes your match history, pinned hands, and Apple sign-in binding. You can sign back in later, but nothing will be restored.")
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

    private func openNotificationSettings() {
        if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    private func sendFeedback() {
        if let url = URL(string: "mailto:tj@tilted.app?subject=Tilted%20Feedback") {
            UIApplication.shared.open(url)
        }
    }
}

#Preview {
    SettingsView()
        .environment(AppStore())
}

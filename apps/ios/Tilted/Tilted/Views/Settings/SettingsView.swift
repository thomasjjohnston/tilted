import SwiftUI

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

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
                                dismiss()
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
                    }
                    .scrollContentBackground(.hidden)
                    .listStyle(.insetGrouped)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .foregroundColor(.cream200)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("Settings")
                        .font(.displaySmall)
                        .fontDesign(.serif)
                        .foregroundColor(.cream100)
                }
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

import SwiftUI

struct OpponentPickerSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var users: [UserRosterEntry] = []
    @State private var isLoadingList = true
    @State private var isCreating = false
    @State private var errorMessage: String?

    /// Called when a match has been successfully created.
    var onMatchCreated: (MatchState) -> Void

    /// Opponents the user already has an active match with — these get a
    /// "busy" pill and are disabled in the picker.
    private var opponentsWithActiveMatch: Set<String> {
        Set(store.matches.map { $0.opponent.userId })
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.clear.feltBackground().ignoresSafeArea()

                if isLoadingList {
                    ProgressView().tint(.gold500)
                } else if users.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Pick your opponent")
                        .font(.eyebrow)
                        .tracking(1.5)
                        .foregroundColor(.cream300)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.cream200)
                }
            }
            .task { await loadRoster() }
            .alert("Couldn't start match", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private var list: some View {
        List {
            ForEach(users) { u in
                let isBusy = opponentsWithActiveMatch.contains(u.userId)
                Button {
                    if !isBusy { Task { await challenge(u) } }
                } label: {
                    HStack(spacing: 12) {
                        AvatarView(initials: u.initials, size: .regular)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(u.displayName)
                                .font(.displaySmall)
                                .fontDesign(.serif)
                                .foregroundColor(.cream100)
                            if isBusy {
                                Text("Active match in progress")
                                    .font(.system(size: 11))
                                    .foregroundColor(.cream400)
                            }
                        }
                        Spacer()
                        if isBusy {
                            Text("Busy")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(.cream400)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color.black.opacity(0.25))
                                .cornerRadius(6)
                        } else {
                            Image(systemName: "chevron.right")
                                .foregroundColor(.gold500)
                                .font(.system(size: 13))
                        }
                    }
                    .padding(.vertical, 4)
                }
                .disabled(isBusy || isCreating)
                .listRowBackground(Color.felt600)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.insetGrouped)
    }

    private var emptyState: some View {
        VStack(spacing: Spacing.md) {
            Text("Nobody else has signed up yet.")
                .font(.displaySmall)
                .fontDesign(.serif)
                .foregroundColor(.cream100)
                .multilineTextAlignment(.center)
            Text("Invite a friend to install Tilted, then come back here to challenge them.")
                .font(.bodySecondary)
                .foregroundColor(.cream300)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
    }

    private func loadRoster() async {
        isLoadingList = true
        defer { isLoadingList = false }
        do {
            users = try await APIClient.shared.listUsers()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func challenge(_ user: UserRosterEntry) async {
        isCreating = true
        defer { isCreating = false }
        do {
            let match = try await APIClient.shared.createMatch(opponentId: user.userId)
            await store.refresh()
            onMatchCreated(match)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    OpponentPickerSheet { _ in }
        .environment(AppStore())
}

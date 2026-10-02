import SwiftUI

/// Settings → Blocked players. Lists who you've blocked and lets you
/// unblock them (spec §27).
struct BlockedPlayersView: View {
    @State private var blocked: [BlockedPlayer] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            if isLoading {
                ProgressView().tint(.gold500)
            } else if blocked.isEmpty {
                VStack(spacing: Spacing.md) {
                    Text("Nobody is blocked.")
                        .font(.displaySmall)
                        .fontDesign(.serif)
                        .foregroundColor(.cream100)
                    Text("To block someone you've played, press and hold their match on Home, or swipe them in the New game list.")
                        .font(.bodySecondary)
                        .foregroundColor(.cream300)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }
            } else {
                List {
                    Section {
                        ForEach(blocked) { p in
                            HStack(spacing: 12) {
                                AvatarView(initials: p.initials, size: .regular)
                                Text(p.displayName)
                                    .font(.displaySmall)
                                    .fontDesign(.serif)
                                    .foregroundColor(.cream100)
                                Spacer()
                                Button("Unblock") { Task { await unblock(p) } }
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundColor(.gold500)
                                    .buttonStyle(.borderless)
                            }
                            .padding(.vertical, 4)
                        }
                    } footer: {
                        Text("Unblocking lets you play each other again. It doesn't bring back a match that ended when you blocked them.")
                            .foregroundColor(.cream400)
                    }
                    .listRowBackground(Color.felt600)
                }
                .scrollContentBackground(.hidden)
                .listStyle(.insetGrouped)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Blocked players")
                    .font(.displaySmall)
                    .fontDesign(.serif)
                    .foregroundColor(.cream100)
            }
        }
        .task { await load() }
        .alert("Something went wrong", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            blocked = try await APIClient.shared.listBlocked()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func unblock(_ player: BlockedPlayer) async {
        do {
            try await APIClient.shared.unblockUser(userId: player.userId)
            blocked.removeAll { $0.userId == player.userId }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack { BlockedPlayersView() }
}

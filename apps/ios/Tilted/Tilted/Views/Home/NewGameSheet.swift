import SwiftUI

/// The one place a match starts (spec §26): play the bot, invite a friend,
/// enter a friend's code, or rematch someone you've played.
struct NewGameSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    /// What the caller wants the sheet to do as soon as it opens.
    enum Intent {
        case none
        /// Create and show an invite straight away (from the how-to-play card).
        case invite
    }

    var intent: Intent = .none

    /// Called when a match has been successfully created.
    var onMatchCreated: (MatchState) -> Void

    @State private var bot: BotAvailability?
    @State private var opponents: [OpponentEntry] = []
    @State private var isLoading = true
    @State private var isWorking = false
    @State private var errorMessage: String?

    @State private var invite: InviteResponse?
    /// Reused across retries of one "Invite a friend" tap so a flaky
    /// network can't mint two invites.
    @State private var inviteTxId = UUID().uuidString

    @State private var codeDraft = ""
    @State private var blockCandidate: OpponentEntry?

    /// True when a match against the bot is already in progress — only one
    /// active match per pair, the bot included.
    private var hasActiveBotMatch: Bool {
        store.matches.contains { $0.opponent.isBot && $0.status == "active" }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.clear.feltBackground().ignoresSafeArea()

                if isLoading {
                    ProgressView().tint(.gold500)
                } else {
                    content
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("New game")
                        .font(.eyebrow)
                        .tracking(1.5)
                        .foregroundColor(.cream300)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.cream200)
                }
            }
            .task { await load() }
            .alert("Couldn't start match", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .alert(
                "Block \(blockCandidate?.displayName ?? "this player")?",
                isPresented: Binding(
                    get: { blockCandidate != nil },
                    set: { if !$0 { blockCandidate = nil } }
                ),
                presenting: blockCandidate
            ) { target in
                Button("Cancel", role: .cancel) {}
                Button("Block", role: .destructive) {
                    Task { await block(target) }
                }
            } message: { _ in
                Text(BlockCopy.confirmation)
            }
        }
    }

    // MARK: - Sections

    private var content: some View {
        List {
            if let bot, bot.available {
                Section {
                    Button {
                        Task { await playBot() }
                    } label: {
                        row(
                            icon: "cpu",
                            title: "Play \(bot.displayName ?? "Untilted")",
                            subtitle: hasActiveBotMatch
                                ? "Match in progress"
                                : "The house bot. Answers instantly, any time."
                        )
                    }
                    .disabled(isWorking || hasActiveBotMatch)
                } header: {
                    header("Play now")
                }
                .listRowBackground(Color.felt600)
            }

            Section {
                if let invite {
                    inviteReady(invite)
                } else {
                    Button {
                        Task { await createInvite() }
                    } label: {
                        row(
                            icon: "paperplane.fill",
                            title: "Invite a friend",
                            subtitle: "Send a link by text. The match starts when they open it."
                        )
                    }
                    .disabled(isWorking)
                }
            } header: {
                header("Play a friend")
            }
            .listRowBackground(Color.felt600)

            Section {
                HStack(spacing: 10) {
                    TextField("Invite code", text: $codeDraft)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.system(size: 17, weight: .medium, design: .monospaced))
                        .foregroundColor(.cream100)
                        .submitLabel(.join)
                        .onSubmit { Task { await redeem() } }
                    Button("Join") { Task { await redeem() } }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(InviteLink.isPlausible(codeDraft) ? .gold500 : .cream400)
                        .disabled(!InviteLink.isPlausible(codeDraft) || isWorking)
                }
            } header: {
                header("Got a code?")
            } footer: {
                Text("If a friend sent you an invite, tap their link or type the code from it.")
                    .foregroundColor(.cream400)
            }
            .listRowBackground(Color.felt600)

            if !opponents.isEmpty {
                Section {
                    ForEach(opponents) { o in
                        Button {
                            if !o.hasActiveMatch { Task { await rematch(o) } }
                        } label: {
                            HStack(spacing: 12) {
                                AvatarView(initials: o.initials, size: .regular)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(o.displayName)
                                        .font(.displaySmall)
                                        .fontDesign(.serif)
                                        .foregroundColor(.cream100)
                                    if o.hasActiveMatch {
                                        Text("Match in progress")
                                            .font(.system(size: 11))
                                            .foregroundColor(.cream400)
                                    }
                                }
                                Spacer()
                                if !o.hasActiveMatch {
                                    Image(systemName: "chevron.right")
                                        .foregroundColor(.gold500)
                                        .font(.system(size: 13))
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .disabled(o.hasActiveMatch || isWorking)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("Block") { blockCandidate = o }
                                .tint(.claret)
                        }
                        .contextMenu {
                            Button(role: .destructive) {
                                blockCandidate = o
                            } label: {
                                Label("Block \(o.displayName)", systemImage: "hand.raised.fill")
                            }
                        }
                    }
                } header: {
                    header("Play again")
                }
                .listRowBackground(Color.felt600)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.insetGrouped)
    }

    private func inviteReady(_ invite: InviteResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Invite ready")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.cream300)
            Text(invite.code)
                .font(.system(size: 24, weight: .semibold, design: .monospaced))
                .tracking(3)
                .foregroundColor(.cream100)
                .textSelection(.enabled)
            ShareLink(
                item: URL(string: invite.url)!,
                message: Text(InviteLink.shareMessage(url: invite.url))
            ) {
                HStack(spacing: 6) {
                    Image(systemName: "square.and.arrow.up")
                    Text("Share link")
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.gold500)
            }
            Text("Works once, for 7 days. The match starts as soon as your friend opens the link or enters the code.")
                .font(.system(size: 11))
                .foregroundColor(.cream400)
        }
        .padding(.vertical, 6)
    }

    private func row(icon: String, title: String, subtitle: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundColor(.gold500)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.displaySmall)
                    .fontDesign(.serif)
                    .foregroundColor(.cream100)
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundColor(.cream400)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func header(_ text: String) -> some View {
        Text(text).foregroundColor(.cream300)
    }

    // MARK: - Actions

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        if intent == .invite, invite == nil { await createInvite() }
        // Independent lookups: a failure of one (e.g. bot check) must not
        // hide the other ways to start a game.
        async let botResult = try? APIClient.shared.getBot()
        async let opponentsResult = try? APIClient.shared.listOpponents()
        bot = await botResult
        opponents = await opponentsResult ?? []
    }

    private func start(_ work: () async throws -> MatchState) async {
        isWorking = true
        defer { isWorking = false }
        do {
            let match = try await work()
            await store.refresh()
            onMatchCreated(match)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func playBot() async {
        await start { try await APIClient.shared.createBotMatch() }
    }

    private func rematch(_ opponent: OpponentEntry) async {
        await start { try await APIClient.shared.createMatch(opponentId: opponent.userId) }
    }

    private func redeem() async {
        guard InviteLink.isPlausible(codeDraft) else { return }
        let code = InviteLink.normalize(codeDraft)
        await start { try await APIClient.shared.redeemInvite(code: code) }
    }

    private func createInvite() async {
        isWorking = true
        defer { isWorking = false }
        do {
            invite = try await APIClient.shared.createInvite(clientTxId: inviteTxId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func block(_ target: OpponentEntry) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await APIClient.shared.blockUser(userId: target.userId)
            opponents.removeAll { $0.userId == target.userId }
            await store.refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Shared wording for block confirmations (new-game list and Home).
enum BlockCopy {
    static let confirmation = "You won't be able to play each other, and any match between you ends now with no winner. They won't be told. You can unblock them in Settings."
}

#Preview {
    NewGameSheet { _ in }
        .environment(AppStore())
}

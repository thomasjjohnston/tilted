import SwiftUI

/// Per-match chat thread — shows every message in the match (both
/// hand-scoped and unscoped). Polling-based: refreshes on appear and
/// when scene becomes active.
///
/// Use `HandChatSidebar` for the per-hand variant.
struct MatchChatView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    let match: MatchState
    /// Optional: when set, the chat is scoped to this hand only.
    var handId: String? = nil

    @State private var draft: String = ""
    @State private var sending = false

    private var messages: [Message] {
        let key = MatchChatView.cacheKey(matchId: match.matchId, handId: handId)
        return store.messagesByCache[key] ?? []
    }

    private var opponentName: String {
        match.opponent.displayName.components(separatedBy: " ").first ?? "Opponent"
    }

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            VStack(spacing: 0) {
                MatchHeaderBar(
                    myAvailable: match.myAvailable,
                    opponentName: opponentName,
                    opponentAvailable: match.opponentAvailable,
                    onBack: { dismiss() },
                    trailing: AnyView(
                        Text(handId == nil ? "Match chat" : "Hand chat")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.cream300)
                    )
                )

                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 6) {
                            ForEach(messages) { msg in
                                bubble(for: msg)
                                    .id(msg.messageId)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                    }
                    .onChange(of: messages.count) { _, _ in
                        if let last = messages.last {
                            withAnimation { proxy.scrollTo(last.messageId, anchor: .bottom) }
                        }
                    }
                }

                composer
            }
        }
        .task {
            await store.loadMessages(matchId: match.matchId, handId: handId)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await store.loadMessages(matchId: match.matchId, handId: handId) }
            }
        }
    }

    @ViewBuilder
    private func bubble(for msg: Message) -> some View {
        let mine = msg.fromUserId == store.currentUserId
        HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
                Text(msg.body)
                    .font(.system(size: 14))
                    .foregroundColor(mine ? .felt800 : .cream100)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        mine
                            ? AnyView(LinearGradient(colors: [.gold500, .gold700], startPoint: .top, endPoint: .bottom))
                            : AnyView(Color.black.opacity(0.3))
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(mine ? .clear : Color.gold500.opacity(0.18), lineWidth: 1)
                    )
                if let ts = TimestampFormatter.format(msg.createdAt) {
                    Text(ts)
                        .font(.system(size: 9))
                        .foregroundColor(.cream400)
                }
            }
            if !mine { Spacer(minLength: 40) }
        }
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("Say something to \(opponentName)…", text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...4)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.black.opacity(0.3))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(Color.gold500.opacity(0.25), lineWidth: 1)
                )
                .cornerRadius(18)
                .foregroundColor(.cream100)

            Button {
                let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !body.isEmpty, !sending else { return }
                draft = ""
                sending = true
                Task {
                    await store.sendMessage(matchId: match.matchId, body: body, handId: handId)
                    sending = false
                }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundColor(
                        draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? .cream400 : .gold500
                    )
            }
            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.felt800.opacity(0.95))
        .overlay(
            Rectangle().fill(Color.gold500.opacity(0.1)).frame(height: 1),
            alignment: .top
        )
    }

    static func cacheKey(matchId: String, handId: String?) -> String {
        if let handId { return "\(matchId)#\(handId)" }
        return matchId
    }
}

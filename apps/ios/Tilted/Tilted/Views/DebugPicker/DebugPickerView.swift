import SwiftUI

struct DebugPickerView: View {
    @Environment(AppStore.self) private var store
    @State private var selectedUserId: String?
    @State private var isLoading = false

    var body: some View {
        ZStack {
            Color.clear.feltBackground()

            VStack(spacing: 0) {
                Spacer()

                Text("MVP BUILD \u{00B7} HARDCODED SEATS")
                    .font(.eyebrow)
                    .tracking(1.5)
                    .foregroundColor(.cream300)
                    .padding(.bottom, Spacing.sm)

                Text("Who's playing?")
                    .font(.displayMedium)
                    .fontDesign(.serif)
                    .foregroundColor(.cream100)

                dividerLine

                VStack(spacing: Spacing.md) {
                    ForEach(HardcodedUsers.users, id: \.id) { user in
                        userRow(user: user)
                    }
                }
                .padding(.horizontal)

                Spacer()

                if let selected = selectedUserId,
                   let user = HardcodedUsers.users.first(where: { $0.id == selected }) {
                    Button("Continue as \(user.name.components(separatedBy: " ").first ?? user.name)") {
                        Task { await login(userId: selected) }
                    }
                    .buttonStyle(.primary)
                    .disabled(isLoading)
                    .padding(.horizontal)
                }

                Text("MVP auth will be replaced by Sign in with Apple in v2.")
                    .font(.caption)
                    .foregroundColor(.cream300)
                    .multilineTextAlignment(.center)
                    .padding(.top, Spacing.sm)
                    .padding(.bottom, Spacing.xl)
                    .padding(.horizontal)
            }
        }
        .ignoresSafeArea()
    }

    private func userRow(user: (id: String, name: String, initials: String)) -> some View {
        let isSelected = selectedUserId == user.id
        return Button {
            selectedUserId = user.id
        } label: {
            HStack(spacing: 12) {
                AvatarView(initials: user.initials, size: .large)

                VStack(alignment: .leading, spacing: 2) {
                    Text(user.name)
                        .font(.displaySmall)
                        .fontDesign(.serif)
                        .foregroundColor(.cream100)
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundColor(.gold500)
                        .font(.system(size: 18))
                }
            }
            .padding(14)
            .background(isSelected ? Color.gold500.opacity(0.08) : .clear)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(
                        isSelected ? Color.gold500.opacity(0.6) : Color.gold500.opacity(0.2),
                        lineWidth: 1
                    )
            )
            .cornerRadius(14)
        }
    }

    private var dividerLine: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [.clear, .gold600, .clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .frame(height: 1)
            .opacity(0.7)
            .padding(.vertical, 14)
    }

    private func login(userId: String) async {
        isLoading = true
        do {
            try await store.login(userId: userId)
        } catch {
            store.error = error.localizedDescription
        }
        isLoading = false
    }
}

#Preview {
    DebugPickerView()
        .environment(AppStore())
}

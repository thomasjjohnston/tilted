import SwiftUI

struct DebugPickerView: View {
    @Environment(AppStore.self) private var store
    @State private var selectedUserId: String?
    @State private var pinEntry = ""
    @State private var pinError = false
    @State private var isLoading = false

    private var selectedUser: (id: String, name: String, initials: String, pin: String)? {
        guard let id = selectedUserId else { return nil }
        return HardcodedUsers.users.first(where: { $0.id == id })
    }

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

                // PIN entry (shown after selecting a user)
                if let user = selectedUser {
                    VStack(spacing: 12) {
                        Text("Enter PIN for \(user.name.components(separatedBy: " ").first ?? user.name)")
                            .font(.system(size: 13))
                            .foregroundColor(.cream200)

                        HStack(spacing: 12) {
                            ForEach(0..<4, id: \.self) { i in
                                Circle()
                                    .fill(i < pinEntry.count ? Color.gold500 : Color.gold500.opacity(0.15))
                                    .frame(width: 14, height: 14)
                                    .overlay(
                                        Circle()
                                            .stroke(pinError ? Color.claret : Color.gold500.opacity(0.3), lineWidth: 1)
                                    )
                            }
                        }

                        if pinError {
                            Text("Wrong PIN")
                                .font(.system(size: 12))
                                .foregroundColor(.claret)
                        }

                        // Number pad
                        VStack(spacing: 8) {
                            ForEach(0..<3, id: \.self) { row in
                                HStack(spacing: 12) {
                                    ForEach(1...3, id: \.self) { col in
                                        let digit = row * 3 + col
                                        pinButton(String(digit))
                                    }
                                }
                            }
                            HStack(spacing: 12) {
                                Color.clear.frame(width: 60, height: 44)
                                pinButton("0")
                                Button {
                                    if !pinEntry.isEmpty {
                                        pinEntry.removeLast()
                                        pinError = false
                                    }
                                } label: {
                                    Image(systemName: "delete.left")
                                        .font(.system(size: 18))
                                        .foregroundColor(.cream200)
                                        .frame(width: 60, height: 44)
                                }
                            }
                        }
                    }
                    .padding(.bottom, Spacing.xl)
                }
            }
        }
        .ignoresSafeArea()
    }

    private func pinButton(_ digit: String) -> some View {
        Button {
            guard pinEntry.count < 4 else { return }
            pinEntry += digit
            pinError = false

            if pinEntry.count == 4 {
                if let user = selectedUser, pinEntry == user.pin {
                    Task { await login(userId: user.id) }
                } else {
                    pinError = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        pinEntry = ""
                    }
                }
            }
        } label: {
            Text(digit)
                .font(.system(size: 22, weight: .medium))
                .foregroundColor(.cream100)
                .frame(width: 60, height: 44)
                .background(Color.cream100.opacity(0.06))
                .cornerRadius(10)
        }
    }

    private func userRow(user: (id: String, name: String, initials: String, pin: String)) -> some View {
        let isSelected = selectedUserId == user.id
        return Button {
            selectedUserId = user.id
            pinEntry = ""
            pinError = false
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

import SwiftUI
import AuthenticationServices

struct SignInView: View {
    @Environment(AppStore.self) private var store
    @State private var error: String?
    @State private var isSigningIn = false
    #if DEBUG
    @State private var showServerSheet = false
    @State private var debugServerDraft = ""
    #endif

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            VStack(spacing: Spacing.xl) {
                Spacer()

                VStack(spacing: Spacing.md) {
                    Text("TILTED")
                        .font(.system(size: 12, weight: .medium))
                        .tracking(3)
                        .foregroundColor(.gold500)

                    Text("Heads-up poker\nwith friends.")
                        .font(.displayLarge)
                        .fontDesign(.serif)
                        .foregroundColor(.cream100)
                        .multilineTextAlignment(.center)
                }

                Spacer()

                VStack(spacing: Spacing.sm) {
                    SignInWithAppleButton(
                        onRequest: { request in
                            request.requestedScopes = [.fullName, .email]
                        },
                        onCompletion: handleResult
                    )
                    .signInWithAppleButtonStyle(.white)
                    .frame(height: 52)
                    .padding(.horizontal, 40)
                    .disabled(isSigningIn)
                    .opacity(isSigningIn ? 0.5 : 1)

                    if let error {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.claret)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }

                    #if DEBUG
                    Button {
                        debugServerDraft = APIClient.debugServerString
                        showServerSheet = true
                    } label: {
                        Text("Server: \(APIClient.debugServerString.isEmpty ? "production" : APIClient.debugServerString)")
                            .font(.system(size: 11))
                            .foregroundColor(.cream400)
                            .padding(.top, 8)
                    }
                    .alert("Local server URL", isPresented: $showServerSheet) {
                        TextField("http://192.168.x.x:3000", text: $debugServerDraft)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                        Button("Apply") { APIClient.applyDebugServer(debugServerDraft) }
                        Button("Reset to production") {
                            debugServerDraft = ""
                            APIClient.applyDebugServer("")
                        }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("DEBUG only. Point this build at your laptop's local stack, then sign in. See docs/LOCAL-TESTING.md.")
                    }
                    #endif
                }

                Spacer().frame(height: 48)
            }
        }
    }

    private func handleResult(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure(let err):
            // User-cancelled errors have code .canceled — don't surface those
            if (err as? ASAuthorizationError)?.code == .canceled {
                return
            }
            error = err.localizedDescription

        case .success(let auth):
            guard let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8) else {
                error = "Missing identity token from Apple"
                return
            }

            let nameParts = [
                credential.fullName?.givenName,
                credential.fullName?.familyName,
            ].compactMap { $0 }
            let fullName = nameParts.isEmpty ? nil : nameParts.joined(separator: " ")

            error = nil
            isSigningIn = true
            Task {
                defer { Task { @MainActor in isSigningIn = false } }
                do {
                    try await store.signInWithApple(
                        identityToken: token,
                        fullName: fullName,
                        email: credential.email
                    )
                } catch {
                    await MainActor.run {
                        self.error = error.localizedDescription
                    }
                }
            }
        }
    }
}

#Preview {
    SignInView()
        .environment(AppStore())
}

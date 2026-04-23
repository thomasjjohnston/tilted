import Foundation
import SwiftUI

@Observable
final class AppStore {
    // MARK: - Auth State
    var isAuthenticated = false
    var currentUserId: String?
    var currentUserName: String?

    // MARK: - Match State
    /// All active matches the current user is in, newest-first.
    var matches: [MatchState] = []
    /// The currently-selected match for per-match detail screens
    /// (Turn, Reveal, etc.). When only one match exists this equals
    /// `matches.first`; when multiple, it's whichever the user drilled into.
    var matchState: MatchState?
    var isLoading = false
    var hasInitiallyLoaded = false
    var error: String?

    // MARK: - Navigation
    var activeScreen: ActiveScreen = .home
    var selectedTab: Tab = .home

    enum ActiveScreen: Equatable {
        case home
        case turn
        case reveal
        case history
        case settings
        case handDetail(String)
    }

    enum Tab: Hashable {
        case home, matchUp, history, settings
    }

    // MARK: - Auth

    func checkAuth() {
        if let token = KeychainHelper.load(key: "auth_token"),
           let userId = KeychainHelper.load(key: "user_id") {
            Task {
                await APIClient.shared.setToken(token)
                self.currentUserId = userId
                self.currentUserName = KeychainHelper.load(key: "user_name")
                self.isAuthenticated = true
                PushRegistrar.shared.uploadTokenIfAuthenticated()
                await refresh()
            }
        }
    }

    func login(userId: String) async throws {
        let response = try await APIClient.shared.debugSelect(userId: userId)
        await applyAuth(response: response)
    }

    func signInWithApple(identityToken: String, fullName: String?, email: String?) async throws {
        let response = try await APIClient.shared.signInApple(
            identityToken: identityToken,
            fullName: fullName,
            email: email
        )
        await applyAuth(response: response)
    }

    private func applyAuth(response: AuthResponse) async {
        await APIClient.shared.setToken(response.token)

        KeychainHelper.save(key: "auth_token", value: response.token)
        KeychainHelper.save(key: "user_id", value: response.userId)
        KeychainHelper.save(key: "user_name", value: response.displayName)

        self.currentUserId = response.userId
        self.currentUserName = response.displayName
        self.isAuthenticated = true
        PushRegistrar.shared.uploadTokenIfAuthenticated()

        await refresh()
    }

    func logout() {
        KeychainHelper.delete(key: "auth_token")
        KeychainHelper.delete(key: "user_id")
        KeychainHelper.delete(key: "user_name")
        self.isAuthenticated = false
        self.currentUserId = nil
        self.currentUserName = nil
        self.matchState = nil
        self.matches = []
        self.hasInitiallyLoaded = false
    }

    @MainActor
    func deleteAccount() async throws {
        try await APIClient.shared.deleteAccount()
        logout()
    }

    // MARK: - Refresh

    @MainActor
    func refresh() async {
        isLoading = true
        error = nil
        do {
            let list = try await APIClient.shared.listMatches()
            matches = list
            // If the user had a selected match, keep pointing to its refreshed
            // version so per-match views don't lose their state. Otherwise
            // default to the most recently-created match.
            if let selectedId = matchState?.matchId,
               let found = list.first(where: { $0.matchId == selectedId }) {
                matchState = found
            } else {
                matchState = list.first
            }
        } catch APIError.unauthorized {
            // Stale bearer in Keychain (server forgot this token, or user
            // was deleted). Clear and force sign-in.
            logout()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
        hasInitiallyLoaded = true
    }

    @MainActor
    func selectMatch(_ match: MatchState) {
        matchState = match
    }

    // MARK: - Match Actions

    @MainActor
    func startNewMatch(opponentId: String) async {
        isLoading = true
        error = nil
        do {
            let newMatch = try await APIClient.shared.createMatch(opponentId: opponentId)
            matchState = newMatch
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    func optimisticallyResolveHand(handId: String, action: String) {
        guard var round = matchState?.currentRound,
              let idx = round.hands.firstIndex(where: { $0.handId == handId }) else { return }
        let old = round.hands[idx]
        let optimistic = HandView(
            handId: old.handId,
            handIndex: old.handIndex,
            myHole: old.myHole,
            opponentHole: old.opponentHole,
            board: old.board,
            pot: old.pot,
            myReserved: old.myReserved,
            opponentReserved: old.opponentReserved,
            street: old.street,
            status: action == "fold" ? "complete" : old.status,
            actionOnMe: false,
            terminalReason: action == "fold" ? "fold" : old.terminalReason,
            winnerUserId: old.winnerUserId,
            actionSummary: old.actionSummary
        )
        round.hands[idx] = optimistic
        matchState?.currentRound = round
    }

    @MainActor
    func submitAction(handId: String, type: String, amount: Int? = nil) async {
        let clientTxId = UUID().uuidString

        // Optimistic update: immediately mark hand as no longer pending
        optimisticallyResolveHand(handId: handId, action: type)

        do {
            matchState = try await APIClient.shared.submitAction(
                handId: handId, type: type, amount: amount, clientTxId: clientTxId
            )
        } catch {
            self.error = error.localizedDescription
            await refresh()
        }
    }

    @MainActor
    func submitBatchActions(actions: [(handId: String, type: String, amount: Int?)]) async {
        // Optimistic: mark all hands as resolved immediately
        for action in actions {
            optimisticallyResolveHand(handId: action.handId, action: action.type)
        }

        // Fire server call in background — don't block the UI
        let capturedActions = actions
        Task.detached { [weak self] in
            do {
                let result = try await APIClient.shared.submitBatchActions(actions: capturedActions)
                await MainActor.run {
                    self?.matchState = result
                }
            } catch {
                await MainActor.run {
                    self?.error = error.localizedDescription
                }
                // Refresh to reconcile on error
                await self?.refresh()
            }
        }
    }

    @MainActor
    func advanceRound(roundId: String) async {
        do {
            matchState = try await APIClient.shared.advanceRound(roundId: roundId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    func toggleFavorite(handId: String, favorite: Bool) async {
        do {
            try await APIClient.shared.toggleFavorite(handId: handId, favorite: favorite)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

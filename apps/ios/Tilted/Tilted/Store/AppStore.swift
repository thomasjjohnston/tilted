import Foundation
import SwiftUI

@Observable
final class AppStore {
    // MARK: - Auth State
    var isAuthenticated = false
    var currentUserId: String?
    var currentUserName: String?

    // MARK: - Match State
    var matchState: MatchState?
    var isLoading = false
    var hasInitiallyLoaded = false
    var error: String?

    // MARK: - Navigation
    var activeScreen: ActiveScreen = .home

    enum ActiveScreen: Equatable {
        case home
        case turn
        case reveal
        case history
        case settings
        case handDetail(String)
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
                await refresh()
            }
        }
    }

    func login(userId: String) async throws {
        let response = try await APIClient.shared.debugSelect(userId: userId)
        await APIClient.shared.setToken(response.token)

        KeychainHelper.save(key: "auth_token", value: response.token)
        KeychainHelper.save(key: "user_id", value: response.userId)
        KeychainHelper.save(key: "user_name", value: response.displayName)

        self.currentUserId = response.userId
        self.currentUserName = response.displayName
        self.isAuthenticated = true

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
        self.hasInitiallyLoaded = false
    }

    // MARK: - Refresh

    @MainActor
    func refresh() async {
        isLoading = true
        error = nil
        do {
            matchState = try await APIClient.shared.getCurrentMatch()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
        hasInitiallyLoaded = true
    }

    // MARK: - Match Actions

    @MainActor
    func startNewMatch() async {
        isLoading = true
        error = nil
        do {
            matchState = try await APIClient.shared.createMatch()
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

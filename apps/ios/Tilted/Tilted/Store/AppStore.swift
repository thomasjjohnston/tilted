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
    var error: String?

    // MARK: - Navigation
    var activeScreen: ActiveScreen = .home

    enum ActiveScreen {
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
    func submitAction(handId: String, type: String, amount: Int? = nil) async {
        let clientTxId = UUID().uuidString
        do {
            matchState = try await APIClient.shared.submitAction(
                handId: handId, type: type, amount: amount, clientTxId: clientTxId
            )
        } catch {
            self.error = error.localizedDescription
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

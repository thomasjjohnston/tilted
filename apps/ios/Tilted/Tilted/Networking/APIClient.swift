import Foundation

actor APIClient {
    static let shared = APIClient()

    private var baseURL = APIClient.defaultBaseURL

    private var token: String?

    init() {
        #if DEBUG
        // In DEBUG builds, honor a persisted server override so a device
        // can point at a laptop running the local stack (docs/LOCAL-TESTING.md).
        if let override = APIClient.debugServerURL {
            baseURL = override
        }
        #endif
    }

    static let defaultBaseURL = URL(string: "https://tilted-server.fly.dev")!

    func setToken(_ token: String) {
        self.token = token
    }

    func setBaseURL(_ url: URL) {
        self.baseURL = url
    }

    // MARK: - Auth

    func debugSelect(userId: String) async throws -> AuthResponse {
        return try await post("/v1/auth/debug/select", body: ["user_id": userId], authenticated: false)
    }

    func signInApple(identityToken: String, fullName: String?, email: String?) async throws -> AuthResponse {
        var body: [String: Any] = ["identity_token": identityToken]
        if let fullName { body["full_name"] = fullName }
        if let email { body["email"] = email }
        return try await post("/v1/auth/apple", body: body, authenticated: false)
    }

    // MARK: - Me

    func getMe() async throws -> UserResponse {
        return try await get("/v1/me")
    }

    func updateApnsToken(_ token: String) async throws {
        let _: EmptyResponse = try await post("/v1/me/apns-token", body: ["apns_token": token])
        // 204 no content
    }

    func deleteAccount() async throws {
        var request = URLRequest(url: makeURL(path: "/v1/me"))
        request.httpMethod = "DELETE"
        if let token = token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let _: DeleteResponse = try await execute(request)
    }

    // MARK: - Match

    func getCurrentMatch() async throws -> MatchState? {
        do {
            return try await get("/v1/match/current")
        } catch APIError.notFound {
            return nil
        }
    }

    func listMatches() async throws -> [MatchState] {
        return try await get("/v1/matches")
    }

    func createMatch(opponentId: String) async throws -> MatchState {
        return try await post("/v1/match", body: ["opponent_user_id": opponentId])
    }

    // MARK: - Users roster

    func listUsers() async throws -> [UserRosterEntry] {
        return try await get("/v1/users")
    }

    // MARK: - Hand

    func submitAction(handId: String, type: String, amount: Int?, clientTxId: String) async throws -> MatchState {
        var body: [String: Any] = [
            "type": type,
            "client_tx_id": clientTxId,
        ]
        if let amount = amount {
            body["amount"] = amount
        }
        return try await post("/v1/hand/\(handId)/action", body: body)
    }

    func submitBatchActions(actions: [(handId: String, type: String, amount: Int?)]) async throws -> MatchState {
        let body: [String: Any] = [
            "actions": actions.map { action -> [String: Any] in
                var a: [String: Any] = [
                    "hand_id": action.handId,
                    "type": action.type,
                    "client_tx_id": UUID().uuidString,
                ]
                if let amount = action.amount {
                    a["amount"] = amount
                }
                return a
            }
        ]
        return try await post("/v1/batch-actions", body: body)
    }

    /// Submit a whole turn as one all-or-nothing batch (the cart, spec §6).
    /// `clientTxId`s are caller-provided and stable so a network retry
    /// dedupes server-side rather than double-applying.
    func submitTurn(
        roundId: String?,
        turnTxId: String,
        actions: [(handId: String, type: String, amount: Int?, clientTxId: String)]
    ) async throws -> MatchState {
        var body: [String: Any] = [
            "turn_tx_id": turnTxId,
            "actions": actions.map { a -> [String: Any] in
                var d: [String: Any] = [
                    "hand_id": a.handId,
                    "type": a.type,
                    "client_tx_id": a.clientTxId,
                ]
                if let amount = a.amount { d["amount"] = amount }
                return d
            },
        ]
        if let roundId { body["round_id"] = roundId }
        return try await post("/v1/turn/submit", body: body)
    }

    func getLegalActions(handId: String) async throws -> LegalActionsResponse {
        return try await get("/v1/hand/\(handId)/legal-actions")
    }

    func getHandDetail(handId: String) async throws -> HandDetail {
        return try await get("/v1/hand/\(handId)")
    }

    func toggleFavorite(handId: String, favorite: Bool) async throws {
        let _: EmptyResponse = try await post(
            "/v1/hand/\(handId)/favorite",
            body: ["favorite": favorite]
        )
    }

    // MARK: - Round

    func advanceRound(roundId: String) async throws -> MatchState {
        return try await post("/v1/round/\(roundId)/advance", body: [:] as [String: String])
    }

    // MARK: - Match-up

    func getMatchUp(opponentId: String? = nil) async throws -> MatchUpResponse {
        var query: [String: String] = [:]
        if let opponentId { query["opponent_user_id"] = opponentId }
        return try await get("/v1/matchup", query: query)
    }

    // MARK: - History

    func getHistory(matchId: String? = nil, favorites: Bool = false, result: String = "all") async throws -> HistoryResponse {
        let path = matchId.map { "/v1/match/\($0)/history" } ?? "/v1/history"
        var query: [String: String] = [:]
        if favorites { query["favorites"] = "true" }
        if result != "all" { query["result"] = result }
        return try await get(path, query: query)
    }

    // MARK: - Ping

    func pingOpponent(matchId: String) async throws -> PingResponse {
        return try await post("/v1/match/\(matchId)/ping", body: [:] as [String: String])
    }

    // MARK: - HTTP

    /// Build a URL by appending `path` and attaching `query` as proper
    /// percent-encoded query items. `URL.appendingPathComponent` alone
    /// encodes `?` into `%3F`, so anything jammed into the path string
    /// gets silently dropped from the request. Always go through this.
    func makeURL(path: String, query: [String: String] = [:]) -> URL {
        var comps = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            // Sort by key so multi-param URLs are deterministic (and tests stable).
            comps.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return comps.url!
    }

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:], authenticated: Bool = true) async throws -> T {
        var request = URLRequest(url: makeURL(path: path, query: query))
        request.httpMethod = "GET"
        if authenticated, let token = token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return try await execute(request)
    }

    private func post<T: Decodable>(_ path: String, body: Any, authenticated: Bool = true) async throws -> T {
        var request = URLRequest(url: makeURL(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authenticated, let token = token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await execute(request)
    }

    private func execute<T: Decodable>(_ request: URLRequest, retries: Int = 3) async throws -> T {
        var lastError: Error?

        for attempt in 0..<retries {
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw APIError.invalidResponse
                }

                if http.statusCode == 204 {
                    // No content — return empty
                    if T.self == EmptyResponse.self {
                        return EmptyResponse() as! T
                    }
                }

                if http.statusCode == 404 {
                    throw APIError.notFound
                }

                if http.statusCode == 401 {
                    throw APIError.unauthorized
                }

                // 422 = illegal game action (below min-raise, over-committed,
                // not your turn). Surface the server's message cleanly so the
                // UI shows a real error instead of a raw dump (feedback S7-4).
                if http.statusCode == 422 {
                    let message = (try? JSONDecoder().decode(GameRuleErrorBody.self, from: data))?.message
                        ?? "That move isn't allowed."
                    throw APIError.gameRule(message: message)
                }

                guard (200...299).contains(http.statusCode) else {
                    let body = String(data: data, encoding: .utf8) ?? ""
                    throw APIError.serverError(status: http.statusCode, body: body)
                }

                let decoder = JSONDecoder()
                return try decoder.decode(T.self, from: data)
            } catch let error as APIError {
                throw error
            } catch {
                lastError = error
                if attempt < retries - 1 {
                    // Jittered backoff
                    let delay = Double(attempt + 1) * 0.5 + Double.random(in: 0...0.3)
                    try await Task.sleep(for: .seconds(delay))
                }
            }
        }

        throw lastError ?? APIError.unknown
    }
}

struct EmptyResponse: Decodable {}
struct DeleteResponse: Decodable {
    let ok: Bool
}

private struct GameRuleErrorBody: Decodable {
    let message: String
}

#if DEBUG
// DEBUG-only server override for local end-to-end testing on a device.
// The value persists in UserDefaults and is applied at launch (APIClient.init)
// and immediately when changed. See docs/LOCAL-TESTING.md.
extension APIClient {
    static let debugServerKey = "debug_server_url"

    /// Current override as a URL, or nil when unset/blank (→ use Fly default).
    static var debugServerURL: URL? {
        guard let s = UserDefaults.standard.string(forKey: debugServerKey),
              !s.trimmingCharacters(in: .whitespaces).isEmpty,
              let url = URL(string: s) else { return nil }
        return url
    }

    /// The string shown in the debug field (empty = Fly production default).
    static var debugServerString: String {
        UserDefaults.standard.string(forKey: debugServerKey) ?? ""
    }

    /// Persist + apply a new server URL. Empty string clears the override.
    static func applyDebugServer(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        UserDefaults.standard.set(trimmed, forKey: debugServerKey)
        let url = (trimmed.isEmpty ? nil : URL(string: trimmed)) ?? defaultBaseURL
        Task { await APIClient.shared.setBaseURL(url) }
    }
}
#endif

enum APIError: Error, LocalizedError {
    case invalidResponse
    case notFound
    case unauthorized
    case gameRule(message: String)
    case serverError(status: Int, body: String)
    case unknown

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid response from server"
        case .notFound: return "Resource not found"
        case .unauthorized: return "Session expired — sign in again"
        case .gameRule(let message): return message
        case .serverError(let status, let body): return "Server error \(status): \(body)"
        case .unknown: return "Unknown error"
        }
    }
}

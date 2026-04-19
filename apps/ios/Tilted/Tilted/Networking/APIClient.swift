import Foundation

actor APIClient {
    static let shared = APIClient()

    private var baseURL = URL(string: "https://tilted-server.fly.dev")!

    private var token: String?

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

    // MARK: - Me

    func getMe() async throws -> UserResponse {
        return try await get("/v1/me")
    }

    func updateApnsToken(_ token: String) async throws {
        let _: EmptyResponse = try await post("/v1/me/apns-token", body: ["apns_token": token])
        // 204 no content
    }

    // MARK: - Match

    func getCurrentMatch() async throws -> MatchState? {
        do {
            return try await get("/v1/match/current")
        } catch APIError.notFound {
            return nil
        }
    }

    func createMatch() async throws -> MatchState {
        return try await post("/v1/match", body: [:] as [String: String])
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

    // MARK: - History

    func getHistory(matchId: String? = nil, favorites: Bool = false, result: String = "all") async throws -> HistoryResponse {
        var path = "/v1/history"
        if let matchId = matchId {
            path = "/v1/match/\(matchId)/history"
        }
        var params: [String] = []
        if favorites { params.append("favorites=true") }
        if result != "all" { params.append("result=\(result)") }
        if !params.isEmpty { path += "?" + params.joined(separator: "&") }
        return try await get(path)
    }

    // MARK: - HTTP

    private func get<T: Decodable>(_ path: String, authenticated: Bool = true) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "GET"
        if authenticated, let token = token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return try await execute(request)
    }

    private func post<T: Decodable>(_ path: String, body: Any, authenticated: Bool = true) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
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

enum APIError: Error, LocalizedError {
    case invalidResponse
    case notFound
    case serverError(status: Int, body: String)
    case unknown

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid response from server"
        case .notFound: return "Resource not found"
        case .serverError(let status, let body): return "Server error \(status): \(body)"
        case .unknown: return "Unknown error"
        }
    }
}

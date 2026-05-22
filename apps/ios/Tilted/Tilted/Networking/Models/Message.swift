import Foundation

/// Chat message between the two participants of a match. Optionally
/// scoped to a specific hand via `handId` (hand-sidebar messages); a
/// null `handId` means a match-thread message.
struct Message: Codable, Identifiable {
    let messageId: String
    let matchId: String
    let handId: String?
    let fromUserId: String
    let body: String
    /// ISO8601 timestamp from the server.
    let createdAt: String

    var id: String { messageId }

    enum CodingKeys: String, CodingKey {
        case messageId = "message_id"
        case matchId = "match_id"
        case handId = "hand_id"
        case fromUserId = "from_user_id"
        case body
        case createdAt = "created_at"
    }
}

/// Wrapper for GET /v1/match/:matchId/messages.
struct MessageListResponse: Codable {
    let messages: [Message]
}

import Foundation

// MARK: - Auth

struct AuthResponse: Codable {
    let token: String
    let userId: String
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case token
        case userId = "user_id"
        case displayName = "display_name"
    }
}

// MARK: - User

struct UserResponse: Codable {
    let userId: String
    let displayName: String
    let apnsToken: String?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case displayName = "display_name"
        case apnsToken = "apns_token"
    }
}

// MARK: - Match

struct MatchState: Codable, Identifiable {
    let matchId: String
    let status: String
    let winnerUserId: String?
    let opponent: Opponent
    let myTotal: Int
    let opponentTotal: Int
    let myReserved: Int
    let opponentReserved: Int
    let myAvailable: Int
    let opponentAvailable: Int
    var currentRound: RoundView?

    var id: String { matchId }

    enum CodingKeys: String, CodingKey {
        case matchId = "match_id"
        case status
        case winnerUserId = "winner_user_id"
        case opponent
        case myTotal = "my_total"
        case opponentTotal = "opponent_total"
        case myReserved = "my_reserved"
        case opponentReserved = "opponent_reserved"
        case myAvailable = "my_available"
        case opponentAvailable = "opponent_available"
        case currentRound = "current_round"
    }
}

struct Opponent: Codable {
    let userId: String
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case displayName = "display_name"
    }
}

// MARK: - Round

struct RoundView: Codable {
    let roundId: String
    let roundIndex: Int
    let status: String
    let myRole: String
    let handsPendingMe: Int
    let handsPendingOpponent: Int
    var hands: [HandView]

    enum CodingKeys: String, CodingKey {
        case roundId = "round_id"
        case roundIndex = "round_index"
        case status
        case myRole = "my_role"
        case handsPendingMe = "hands_pending_me"
        case handsPendingOpponent = "hands_pending_opponent"
        case hands
    }
}

// MARK: - Hand

struct HandView: Codable, Identifiable {
    let handId: String
    let handIndex: Int
    let myHole: [String]
    let opponentHole: [String]?
    let board: [String]
    let pot: Int
    let myReserved: Int
    let opponentReserved: Int
    let street: String
    let status: String
    let actionOnMe: Bool
    let terminalReason: String?
    let winnerUserId: String?
    let actionSummary: String

    var id: String { handId }

    var isTerminal: Bool {
        status == "complete" || status == "awaiting_runout"
    }

    var isPendingAction: Bool {
        status == "in_progress" && actionOnMe
    }

    var facingBet: Bool {
        opponentReserved > myReserved
    }

    var callCost: Int {
        max(0, opponentReserved - myReserved)
    }

    enum CodingKeys: String, CodingKey {
        case handId = "hand_id"
        case handIndex = "hand_index"
        case myHole = "my_hole"
        case opponentHole = "opponent_hole"
        case board
        case pot
        case myReserved = "my_reserved"
        case opponentReserved = "opponent_reserved"
        case street
        case status
        case actionOnMe = "action_on_me"
        case terminalReason = "terminal_reason"
        case winnerUserId = "winner_user_id"
        case actionSummary = "action_summary"
    }
}

// MARK: - Actions

struct LegalActionsResponse: Codable {
    let actions: [String]
    let minRaise: Int
    let maxBet: Int
    let callAmount: Int
    let potSize: Int
    let availableAfterMinRaise: Int?
    let availableAfterMaxBet: Int?

    enum CodingKeys: String, CodingKey {
        case actions
        case minRaise = "min_raise"
        case maxBet = "max_bet"
        case callAmount = "call_amount"
        case potSize = "pot_size"
        case availableAfterMinRaise = "available_after_min_raise"
        case availableAfterMaxBet = "available_after_max_bet"
    }
}

struct ActionRequest: Codable {
    let type: String
    let amount: Int?
    let clientTxId: String
    let clientSentAt: String?

    enum CodingKeys: String, CodingKey {
        case type
        case amount
        case clientTxId = "client_tx_id"
        case clientSentAt = "client_sent_at"
    }
}

// MARK: - Hand Detail

struct HandDetail: Codable {
    let handId: String
    let handIndex: Int
    let roundIndex: Int
    let matchId: String
    let myHole: [String]
    let opponentHole: [String]?
    let board: [String]
    let pot: Int
    let street: String
    let status: String
    let terminalReason: String?
    let winnerUserId: String?
    let isFavorited: Bool
    let myHandRank: String?
    let opponentHandRank: String?
    let actions: [ActionDetail]

    enum CodingKeys: String, CodingKey {
        case handId = "hand_id"
        case handIndex = "hand_index"
        case roundIndex = "round_index"
        case matchId = "match_id"
        case myHole = "my_hole"
        case opponentHole = "opponent_hole"
        case board
        case pot
        case street
        case status
        case terminalReason = "terminal_reason"
        case winnerUserId = "winner_user_id"
        case isFavorited = "is_favorited"
        case myHandRank = "my_hand_rank"
        case opponentHandRank = "opponent_hand_rank"
        case actions
    }
}

struct ActionDetail: Codable, Identifiable {
    let actionId: String
    let street: String
    let actingUserId: String
    let actionType: String
    let amount: Int
    let potAfter: Int
    let clientSentAt: String?
    let serverRecordedAt: String

    var id: String { actionId }

    enum CodingKeys: String, CodingKey {
        case actionId = "action_id"
        case street
        case actingUserId = "acting_user_id"
        case actionType = "action_type"
        case amount
        case potAfter = "pot_after"
        case clientSentAt = "client_sent_at"
        case serverRecordedAt = "server_recorded_at"
    }
}

// MARK: - History

struct HistoryResponse: Codable {
    let hands: [HistoryHand]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case hands
        case nextCursor = "next_cursor"
    }
}

struct HistoryHand: Codable, Identifiable {
    let handId: String
    let handIndex: Int
    let roundIndex: Int
    let matchId: String
    let board: [String]
    let pot: Int
    let winnerUserId: String?
    let terminalReason: String?
    let isFavorited: Bool
    let completedAt: String?
    let myHole: [String]
    let opponentHole: [String]?
    let actionSketch: String

    var id: String { handId }

    enum CodingKeys: String, CodingKey {
        case handId = "hand_id"
        case handIndex = "hand_index"
        case roundIndex = "round_index"
        case matchId = "match_id"
        case board
        case pot
        case winnerUserId = "winner_user_id"
        case terminalReason = "terminal_reason"
        case isFavorited = "is_favorited"
        case completedAt = "completed_at"
        case myHole = "my_hole"
        case opponentHole = "opponent_hole"
        case actionSketch = "action_sketch"
    }
}

// MARK: - Hardcoded Users

enum HardcodedUsers {
    static let tjId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    static let slId = "b2c3d4e5-f6a7-8901-bcde-f12345678901"

    static let users: [(id: String, name: String, initials: String, pin: String)] = [
        (tjId, "Thomas Johnston", "TJ", "8989"),
        (slId, "Stephen Layton", "SL", "1234"),
    ]
}

import Foundation

struct MatchUpResponse: Codable {
    let you: UserSummary
    let opponent: UserSummary
    let scoreboard: Scoreboard
    let moments: [Moment]
    let headToHead: HeadToHead
    let pinnedHands: [PinnedHand]

    enum CodingKeys: String, CodingKey {
        case you, opponent, scoreboard, moments
        case headToHead = "head_to_head"
        case pinnedHands = "pinned_hands"
    }
}

struct UserSummary: Codable {
    let userId: String
    let displayName: String
    let initials: String

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case displayName = "display_name"
        case initials
    }
}

struct Scoreboard: Codable {
    let matchesWonYou: Int
    let matchesWonOpponent: Int
    let currentStreak: Streak
    let longestStreak: Streak
    let handsPlayed: Int
    let lastMatchDate: String?

    enum CodingKeys: String, CodingKey {
        case matchesWonYou = "matches_won_you"
        case matchesWonOpponent = "matches_won_opponent"
        case currentStreak = "current_streak"
        case longestStreak = "longest_streak"
        case handsPlayed = "hands_played"
        case lastMatchDate = "last_match_date"
    }
}

struct Streak: Codable {
    let who: String
    let count: Int
}

struct Moment: Codable, Identifiable {
    let kind: String
    let handId: String?
    let matchIndex: Int?
    let potBb: Int
    let myHole: [String]?
    let opponentHole: [String]?
    let board: [String]?
    let copy: String
    let occurredAt: String

    var id: String { handId ?? "\(kind)-\(occurredAt)" }

    enum CodingKeys: String, CodingKey {
        case kind
        case handId = "hand_id"
        case matchIndex = "match_index"
        case potBb = "pot_bb"
        case myHole = "my_hole"
        case opponentHole = "opponent_hole"
        case board, copy
        case occurredAt = "occurred_at"
    }
}

struct HeadToHead: Codable {
    let vpipYou: Double
    let vpipOpponent: Double
    let aggressionYou: Double
    let aggressionOpponent: Double
    let showdownWinPctYou: Double
    let showdownWinPctOpponent: Double
    let avgPotBb: Double
    let showdowns: Int

    enum CodingKeys: String, CodingKey {
        case vpipYou = "vpip_you"
        case vpipOpponent = "vpip_opponent"
        case aggressionYou = "aggression_you"
        case aggressionOpponent = "aggression_opponent"
        case showdownWinPctYou = "showdown_win_pct_you"
        case showdownWinPctOpponent = "showdown_win_pct_opponent"
        case avgPotBb = "avg_pot_bb"
        case showdowns
    }
}

struct PinnedHand: Codable, Identifiable {
    let handId: String
    let matchIndex: Int
    let handIndexInRound: Int
    let myHole: [String]
    let opponentHole: [String]?
    let board: [String]
    let pot: Int
    let potBb: Int
    let winnerUserId: String?
    let tag: String
    let tagCopy: String
    let favoritedAt: String

    var id: String { handId }

    enum CodingKeys: String, CodingKey {
        case handId = "hand_id"
        case matchIndex = "match_index"
        case handIndexInRound = "hand_index_in_round"
        case myHole = "my_hole"
        case opponentHole = "opponent_hole"
        case board, pot
        case potBb = "pot_bb"
        case winnerUserId = "winner_user_id"
        case tag
        case tagCopy = "tag_copy"
        case favoritedAt = "favorited_at"
    }
}

import SwiftUI

/// Routes a resolved HandView to the appropriate Completed Hand
/// surface based on its outcome. Used by HomeView's retroactive queue
/// (where any of the three completion types could be next).
struct CompletedHandRouterView: View {
    let hand: HandView
    let match: MatchState
    let onContinue: () -> Void

    @Environment(AppStore.self) private var store

    var body: some View {
        switch outcome {
        case .opponentFolded:
            HandWonView(hand: hand, match: match, onContinue: onContinue)
        case .youFolded:
            HandFoldedView(hand: hand, match: match, onContinue: onContinue)
        case .showdownOrSplit:
            ShowdownResultView(
                hand: hand,
                match: match,
                remainingPendingCount: 0,
                hasNextPending: false,
                onFavorite: { fav in
                    Task { await store.toggleFavorite(handId: hand.handId, favorite: fav) }
                },
                onBackToList: onContinue,
                onNextHand: onContinue
            )
        }
    }

    private enum Outcome {
        case opponentFolded   // terminalReason=fold AND I won
        case youFolded        // terminalReason=fold AND I lost
        case showdownOrSplit  // terminalReason=showdown OR split (winnerUserId nil)
    }

    private var outcome: Outcome {
        if hand.terminalReason == "fold" {
            let opponentWon = hand.winnerUserId == match.opponent.userId
            return opponentWon ? .youFolded : .opponentFolded
        }
        return .showdownOrSplit
    }
}

import Foundation

/// Groups consecutive identical-loss preflop folds so the UI can
/// surface them as a single screen ("You folded 3 hands preflop · −15
/// total"). Only preflop folds collapse — once the flop is seen each
/// fold gets its own screen, per product direction.
///
/// Identity = (foldStreet == "preflop", chipLoss). Two preflop folds
/// that cost 5 each → one group. A preflop fold costing 5 and another
/// costing 10 → two groups.
enum FoldGrouper {

    /// Returns the input ordered into groups. Non-grouped hands come
    /// back as singletons. Preserves the original `hands` order
    /// (preflop folds appear in the same place as the first hand of
    /// their group; singletons stay in place).
    static func group(_ hands: [HandView], currentUserId: String?) -> [[HandView]] {
        var output: [[HandView]] = []

        for hand in hands {
            guard let key = preflopFoldKey(for: hand, currentUserId: currentUserId) else {
                output.append([hand])
                continue
            }
            // Find an existing group with the same key.
            if let idx = output.firstIndex(where: { existing in
                guard let first = existing.first,
                      let firstKey = preflopFoldKey(for: first, currentUserId: currentUserId) else {
                    return false
                }
                return firstKey == key
            }) {
                output[idx].append(hand)
            } else {
                output.append([hand])
            }
        }

        return output
    }

    /// Key for grouping a preflop fold by chip loss. Returns nil for
    /// any hand that isn't a preflop-fold completion or that's missing
    /// the data needed to determine the loss.
    private static func preflopFoldKey(for hand: HandView, currentUserId: String?) -> FoldGroupKey? {
        guard hand.status == "complete",
              hand.terminalReason == "fold",
              hand.foldStreet == "preflop" else { return nil }

        // Only group losses (from the requesting user's perspective).
        // Hands the opponent folded preflop go into HandWonView's path,
        // not grouped folds. We could group those separately later, but
        // the user spec was about *their* fold notifications.
        guard hand.winnerUserId != currentUserId, hand.winnerUserId != nil else { return nil }

        // Need a resolvable chip loss. Prefer the snapshot; fall back
        // to contribution-derived. Never use myReserved (post-settlement
        // it's 0).
        let lossOpt: Int?
        if let n = hand.myResolvedNet { lossOpt = -n }
        else if let c = hand.myContribution { lossOpt = c }
        else { lossOpt = nil }
        guard let loss = lossOpt else { return nil }

        return FoldGroupKey(chipLoss: loss)
    }
}

struct FoldGroupKey: Hashable {
    let chipLoss: Int
}

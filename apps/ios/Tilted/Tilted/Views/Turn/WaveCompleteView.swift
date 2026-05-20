import SwiftUI

/// Brief overlay shown when the user finishes acting on every pending
/// hand at the current street and the picker is about to advance to the
/// next street. Auto-dismissed by the caller (see TurnView's
/// advanceAfterResolution).
struct WaveCompleteView: View {
    let fromStreet: String   // e.g. "preflop"
    let toStreet: String     // e.g. "flop"

    var body: some View {
        ZStack {
            Color.felt900.opacity(0.85).ignoresSafeArea()
            VStack(spacing: 14) {
                Text("WAVE COMPLETE")
                    .font(.system(size: 10, weight: .medium))
                    .tracking(3)
                    .foregroundColor(.gold500)

                Text("\(fromStreet.capitalized) done")
                    .font(.custom("Georgia", size: 28))
                    .foregroundColor(.cream100)

                HStack(spacing: 6) {
                    Text("Advancing to")
                        .font(.system(size: 13))
                        .foregroundColor(.cream300)
                    Text(toStreet.capitalized)
                        .font(.custom("Georgia", size: 15).bold())
                        .foregroundColor(.gold500)
                }

                Image(systemName: "chevron.down")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.gold500.opacity(0.7))
            }
        }
    }
}

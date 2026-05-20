import SwiftUI

/// Persistent header bar shown on every match-related screen. Always
/// surfaces both stacks (yours + opponent's) so you never have to
/// remember them from another screen.
///
/// Layout: [back chevron] [You {avail}] [• {oppName} {avail}] [trailing slot]
struct MatchHeaderBar: View {
    let myAvailable: Int
    let opponentName: String
    let opponentAvailable: Int
    var onBack: (() -> Void)? = nil
    var trailing: AnyView? = nil

    var body: some View {
        HStack(spacing: 12) {
            if let onBack {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                        .foregroundColor(.cream200)
                        .font(.system(size: 18, weight: .medium))
                        .frame(width: 30, height: 30)
                }
            }

            HStack(spacing: 6) {
                Text("You")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1)
                    .foregroundColor(.cream300)
                Text("\(myAvailable)")
                    .font(.custom("Georgia", size: 15).bold())
                    .foregroundColor(.gold500)
            }

            Text("·")
                .font(.system(size: 12))
                .foregroundColor(.cream400)

            HStack(spacing: 6) {
                Text(opponentName)
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1)
                    .foregroundColor(.cream300)
                Text("\(opponentAvailable)")
                    .font(.custom("Georgia", size: 15).bold())
                    .foregroundColor(.cream100)
            }

            Spacer()

            if let trailing { trailing }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.felt800.opacity(0.95))
        .overlay(
            Rectangle()
                .fill(Color.gold500.opacity(0.1))
                .frame(height: 1),
            alignment: .bottom
        )
    }
}

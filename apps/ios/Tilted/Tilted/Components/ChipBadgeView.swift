import SwiftUI

struct ChipBadgeView: View {
    let label: String
    let total: Int
    let available: Int
    let reserved: Int
    var isMe: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.eyebrow)
                .tracking(1.5)
                .foregroundColor(.cream300)

            Text(available.formatted())
                .font(.custom("Georgia", size: 26))
                .foregroundColor(isMe ? .gold500 : .cream100)

            Text("available to bet")
                .font(.system(size: 10))
                .foregroundColor(.cream300)

            Text("\(reserved.formatted()) in play \u{00B7} \(total.formatted()) total")
                .font(.system(size: 10))
                .foregroundColor(.cream400)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.opacity(0.28))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.gold500.opacity(0.3), lineWidth: 1)
        )
        .cornerRadius(10)
    }
}

struct ChipBarView: View {
    let resolved: Int
    let pendingMe: Int
    let pendingOpponent: Int
    let total: Int

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<total, id: \.self) { i in
                RoundedRectangle(cornerRadius: 2)
                    .fill(colorForSegment(i))
                    .frame(height: 8)
            }
        }
    }

    private func colorForSegment(_ index: Int) -> Color {
        if index < resolved {
            return .gold500
        } else if index < resolved + pendingMe {
            return Color.gold500.opacity(0.35)
        } else if index < resolved + pendingMe + pendingOpponent {
            return Color.cream300.opacity(0.35)
        } else {
            return Color.cream100.opacity(0.12)
        }
    }
}

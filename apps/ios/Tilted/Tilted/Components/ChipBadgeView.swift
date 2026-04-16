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

            Text(total.formatted())
                .font(.chipValue)
                .foregroundColor(isMe ? .gold500 : .cream100)
                .fontDesign(.serif)

            Text("Avail \(available.formatted()) \u{00B7} Rsv \(reserved.formatted())")
                .font(.caption)
                .foregroundColor(.cream300)
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

#Preview {
    VStack(spacing: 16) {
        HStack(spacing: 8) {
            ChipBadgeView(label: "You", total: 1840, available: 1595, reserved: 245, isMe: true)
            ChipBadgeView(label: "Sarah", total: 2160, available: 1910, reserved: 250)
        }

        ChipBarView(resolved: 3, pendingMe: 3, pendingOpponent: 0, total: 10)
    }
    .padding()
    .background(Color.felt700)
}

import SwiftUI

struct PlayingCardView: View {
    let card: String  // e.g. "Ah", "Td"
    var size: CardSize = .regular

    enum CardSize {
        case small, regular, large

        var width: CGFloat {
            switch self {
            case .small: return 24
            case .regular: return 30
            case .large: return 40
            }
        }

        var height: CGFloat {
            switch self {
            case .small: return 34
            case .regular: return 42
            case .large: return 56
            }
        }

        var fontSize: CGFloat {
            switch self {
            case .small: return 10
            case .regular: return 13
            case .large: return 17
            }
        }
    }

    private var rank: String {
        guard card.count >= 2 else { return "?" }
        return String(card.prefix(1))
    }

    private var suit: String {
        guard card.count >= 2 else { return "" }
        let s = card.suffix(1)
        switch s {
        case "h": return "\u{2665}" // hearts
        case "d": return "\u{2666}" // diamonds
        case "c": return "\u{2663}" // clubs
        case "s": return "\u{2660}" // spades
        default: return "?"
        }
    }

    private var isRed: Bool {
        card.hasSuffix("h") || card.hasSuffix("d")
    }

    var body: some View {
        VStack(spacing: 0) {
            Text(rank)
                .font(.custom("Georgia", size: size.fontSize).bold())
            Text(suit)
                .font(.system(size: size.fontSize))
        }
        .foregroundColor(isRed ? .cardRed : .cardBlack)
        .frame(width: size.width, height: size.height)
        .background(Color.cream50)
        .cornerRadius(size == .small ? 4 : 5)
        .shadow(color: .black.opacity(0.3), radius: 1, y: 1)
    }
}

struct CardBackView: View {
    var size: PlayingCardView.CardSize = .regular

    var body: some View {
        RoundedRectangle(cornerRadius: size == .small ? 4 : 5)
            .fill(
                LinearGradient(
                    colors: [.felt600, .felt700],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: size == .small ? 4 : 5)
                    .stroke(Color.gold600, lineWidth: 1.5)
            )
            .frame(width: size.width, height: size.height)
    }
}

struct CardPlaceholderView: View {
    var size: PlayingCardView.CardSize = .regular

    var body: some View {
        RoundedRectangle(cornerRadius: size == .small ? 4 : 5)
            .stroke(Color.gold500.opacity(0.35), style: StrokeStyle(lineWidth: 1.5, dash: [4]))
            .frame(width: size.width, height: size.height)
    }
}

#Preview {
    HStack(spacing: 8) {
        PlayingCardView(card: "Ah")
        PlayingCardView(card: "Ks")
        CardBackView()
        CardPlaceholderView()
    }
    .padding()
    .background(Color.felt700)
}

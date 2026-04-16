import SwiftUI

struct PlayingCardView: View {
    let card: String
    var size: CardSize = .regular

    enum CardSize {
        case small, regular, large, xlarge

        var width: CGFloat {
            switch self {
            case .small: return 24
            case .regular: return 30
            case .large: return 40
            case .xlarge: return 48
            }
        }

        var height: CGFloat {
            switch self {
            case .small: return 34
            case .regular: return 42
            case .large: return 56
            case .xlarge: return 68
            }
        }

        var fontSize: CGFloat {
            switch self {
            case .small: return 10
            case .regular: return 13
            case .large: return 17
            case .xlarge: return 22
            }
        }

        var cornerRadius: CGFloat {
            switch self {
            case .small: return 4
            case .regular: return 5
            case .large: return 6
            case .xlarge: return 7
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
        case "h": return "\u{2665}"
        case "d": return "\u{2666}"
        case "c": return "\u{2663}"
        case "s": return "\u{2660}"
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
        .cornerRadius(size.cornerRadius)
        .shadow(color: .black.opacity(0.3), radius: size == .xlarge ? 4 : 1, y: size == .xlarge ? 3 : 1)
    }
}

struct CardBackView: View {
    var size: PlayingCardView.CardSize = .regular

    var body: some View {
        RoundedRectangle(cornerRadius: size.cornerRadius)
            .fill(
                LinearGradient(
                    colors: [.felt600, .felt700],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: size.cornerRadius)
                    .stroke(Color.gold600, lineWidth: 1.5)
            )
            .frame(width: size.width, height: size.height)
    }
}

struct CardPlaceholderView: View {
    var size: PlayingCardView.CardSize = .regular

    var body: some View {
        RoundedRectangle(cornerRadius: size.cornerRadius)
            .stroke(Color.gold500.opacity(0.35), style: StrokeStyle(lineWidth: 1.5, dash: [4]))
            .frame(width: size.width, height: size.height)
    }
}

/// A card that flips from back to face with an animation.
struct FlippingCardView: View {
    let card: String
    var size: PlayingCardView.CardSize = .xlarge
    var delay: Double = 0

    @State private var isFlipped = false

    var body: some View {
        ZStack {
            if isFlipped {
                PlayingCardView(card: card, size: size)
                    .rotation3DEffect(.degrees(0), axis: (x: 0, y: 1, z: 0))
            } else {
                CardBackView(size: size)
                    .rotation3DEffect(.degrees(0), axis: (x: 0, y: 1, z: 0))
            }
        }
        .rotation3DEffect(.degrees(isFlipped ? 0 : 180), axis: (x: 0, y: 1, z: 0))
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                withAnimation(.easeOut(duration: 0.5)) {
                    isFlipped = true
                }
            }
        }
    }
}

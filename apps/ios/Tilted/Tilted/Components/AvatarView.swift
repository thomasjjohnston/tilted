import SwiftUI

struct AvatarView: View {
    let initials: String
    var size: AvatarSize = .regular

    enum AvatarSize {
        case small, regular, large

        var dimension: CGFloat {
            switch self {
            case .small: return 28
            case .regular: return 40
            case .large: return 56
            }
        }

        var fontSize: CGFloat {
            switch self {
            case .small: return 11
            case .regular: return 15
            case .large: return 20
            }
        }
    }

    var body: some View {
        Text(initials)
            .font(.custom("Georgia", size: size.fontSize).bold())
            .foregroundColor(.felt700)
            .frame(width: size.dimension, height: size.dimension)
            .background(
                LinearGradient(
                    colors: [.gold500, .gold800],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .clipShape(Circle())
    }
}

#Preview {
    HStack(spacing: 12) {
        AvatarView(initials: "TJ", size: .large)
        AvatarView(initials: "SF")
        AvatarView(initials: "SF", size: .small)
    }
    .padding()
    .background(Color.felt700)
}

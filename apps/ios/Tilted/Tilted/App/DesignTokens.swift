import SwiftUI

// MARK: - Colors (from mockups §01)

extension Color {
    // Felt greens
    static let felt900 = Color(hex: 0x051c15)
    static let felt800 = Color(hex: 0x082a21)
    static let felt700 = Color(hex: 0x0e3b2e)
    static let felt600 = Color(hex: 0x164a3a)
    static let felt500 = Color(hex: 0x1a5a43)

    // Gold
    static let gold500 = Color(hex: 0xd4b368)
    static let gold600 = Color(hex: 0xc9a961)
    static let gold700 = Color(hex: 0xa88334)
    static let gold800 = Color(hex: 0x7a5f2b)

    // Cream / text
    static let cream50 = Color(hex: 0xf6f1e1)
    static let cream100 = Color(hex: 0xf3ecd6)
    static let cream200 = Color(hex: 0xd9cfb2)
    static let cream300 = Color(hex: 0x9eb7a4)
    static let cream400 = Color(hex: 0x6a8a7a)

    // Accents
    static let claret = Color(hex: 0xc44d42)
    static let cardRed = Color(hex: 0xc92b2b)
    static let cardBlack = Color(hex: 0x111111)

    init(hex: UInt, opacity: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255,
            opacity: opacity
        )
    }
}

// MARK: - Backgrounds

extension View {
    func feltBackground() -> some View {
        self.background(
            RadialGradient(
                gradient: Gradient(colors: [.felt500, .felt700, .felt800]),
                center: .top,
                startRadius: 0,
                endRadius: 600
            )
        )
    }
}

// MARK: - Typography

extension Font {
    static let displayLarge = Font.custom("Georgia", size: 32)
    static let displayMedium = Font.custom("Georgia", size: 26)
    static let displaySmall = Font.custom("Georgia", size: 20)
    static let chipValue = Font.custom("Georgia", size: 22)
    static let cardRank = Font.custom("Georgia", size: 13)

    static let eyebrow = Font.system(size: 10, weight: .medium)
    static let bodyPrimary = Font.system(size: 14)
    static let bodySecondary = Font.system(size: 13)
    static let caption = Font.system(size: 11)
}

// MARK: - Spacing

enum Spacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
}

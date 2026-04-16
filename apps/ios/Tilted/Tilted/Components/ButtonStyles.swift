import SwiftUI

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(.felt800)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(
                LinearGradient(
                    colors: [.gold500, .gold700],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .cornerRadius(12)
            .shadow(color: .black.opacity(0.25), radius: 0, y: 4)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14))
            .foregroundColor(.cream200)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.gold500.opacity(0.3), lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

struct GhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13))
            .foregroundColor(.cream300)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .opacity(configuration.isPressed ? 0.5 : 1)
    }
}

struct DangerButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14))
            .foregroundColor(.claret)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.claret.opacity(0.5), lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

struct ActionButtonView: View {
    let title: String
    var isPrimary: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(isPrimary ? .gold500 : .cream100)
                .padding(.vertical, 9)
                .frame(maxWidth: .infinity)
                .background(
                    isPrimary
                    ? Color.gold500.opacity(0.18)
                    : Color.black.opacity(0.25)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(
                            isPrimary ? Color.gold500.opacity(0.6) : Color.gold500.opacity(0.25),
                            lineWidth: 1
                        )
                )
                .cornerRadius(8)
        }
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var secondary: SecondaryButtonStyle { SecondaryButtonStyle() }
}

extension ButtonStyle where Self == GhostButtonStyle {
    static var ghost: GhostButtonStyle { GhostButtonStyle() }
}

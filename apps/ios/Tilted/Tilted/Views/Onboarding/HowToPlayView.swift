import SwiftUI

/// What the player does when they finish the explainer.
enum HowToPlayOutcome {
    case playBot
    case inviteFriend
    case later
}

/// Four swipeable cards explaining ten-hands-one-stack, shown once after
/// first sign-in and again from Settings. The last card offers the two
/// ways to start playing (launch plan, section D).
struct HowToPlayView: View {
    var onFinish: (HowToPlayOutcome) -> Void

    @State private var pageIndex = 0

    private let lastPage = 3

    var body: some View {
        ZStack {
            Color.clear.feltBackground().ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    Text("HOW TO PLAY")
                        .font(.eyebrow)
                        .tracking(2)
                        .foregroundColor(.gold500)
                    Spacer()
                    if pageIndex < lastPage {
                        Button("Skip") { onFinish(.later) }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.cream300)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)

                TabView(selection: $pageIndex) {
                    tenHands.tag(0)
                    oneStack.tag(1)
                    turns.tag(2)
                    ready.tag(3)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                HStack(spacing: 8) {
                    ForEach(0...lastPage, id: \.self) { i in
                        Capsule()
                            .fill(i == pageIndex ? Color.gold500 : Color.cream300.opacity(0.35))
                            .frame(width: i == pageIndex ? 22 : 8, height: 8)
                            .animation(.easeInOut(duration: 0.2), value: pageIndex)
                    }
                }
                .padding(.bottom, 20)

                if pageIndex < lastPage {
                    Button {
                        withAnimation { pageIndex += 1 }
                    } label: {
                        Text("Next")
                    }
                    .buttonStyle(.primary)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 28)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - Pages

    private var tenHands: some View {
        card(
            title: "Ten hands.\nAt the same time.",
            body: "Tilted is heads-up Texas Hold'em against one friend. Instead of one hand, you're dealt ten at once, and you play them all."
        ) {
            VStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { row in
                    HStack(spacing: 8) {
                        ForEach(0..<2, id: \.self) { col in
                            HStack(spacing: 3) {
                                PlayingCardView(card: demoHands[row * 2 + col].0, size: .regular)
                                PlayingCardView(card: demoHands[row * 2 + col].1, size: .regular)
                            }
                            .padding(8)
                            .background(Color.black.opacity(0.2))
                            .cornerRadius(10)
                        }
                    }
                }
                Text("… and four more")
                    .font(.caption)
                    .foregroundColor(.cream300)
            }
        }
    }

    private var oneStack: some View {
        card(
            title: "One stack.\nEvery chip counts everywhere.",
            body: "All ten hands draw from the same 2,000 chips. Bet big on one hand and you have less for the other nine. Fold the junk, press the good ones."
        ) {
            VStack(spacing: 6) {
                Text("2,000")
                    .font(.custom("Georgia", size: 44).bold())
                    .foregroundColor(.gold500)
                Text("shared by all ten hands")
                    .font(.caption)
                    .foregroundColor(.cream300)
                HStack(spacing: 6) {
                    ForEach(0..<10, id: \.self) { i in
                        RoundedRectangle(cornerRadius: 3)
                            .fill(i < 3 ? Color.gold500 : Color.cream300.opacity(0.35))
                            .frame(width: 18, height: i < 3 ? 34 : 18)
                    }
                }
                .padding(.top, 8)
            }
        }
    }

    private var turns: some View {
        card(
            title: "Take your turn.\nThen it's theirs.",
            body: "Decide every hand that's waiting on you and send them all at once. Your friend gets a notification, and you get one when it's your turn again. No clock: play when you have a minute."
        ) {
            VStack(spacing: 12) {
                turnRow(name: "You", status: "4 hands decided, 6 to go", active: true)
                turnRow(name: "Dana", status: "Waiting for your turn", active: false)
            }
            .padding(.horizontal, 12)
        }
    }

    private var ready: some View {
        VStack(spacing: Spacing.lg) {
            Spacer()
            Text("Ready to deal?")
                .font(.displayLarge)
                .fontDesign(.serif)
                .foregroundColor(.cream100)
                .multilineTextAlignment(.center)
            Text("Two ways to start.")
                .font(.bodySecondary)
                .foregroundColor(.cream300)
            Spacer()

            VStack(spacing: Spacing.md) {
                Button {
                    onFinish(.playBot)
                } label: {
                    Text("Play Untilted, the house bot")
                }
                .buttonStyle(.primary)
                Text("It answers instantly, so you can learn the game right now.")
                    .font(.caption)
                    .foregroundColor(.cream300)
                    .multilineTextAlignment(.center)

                Button {
                    onFinish(.inviteFriend)
                } label: {
                    Text("Invite a friend")
                }
                .buttonStyle(.secondary)
                .padding(.top, 8)
                Text("We'll make you a link to send by text. The match starts when they open it.")
                    .font(.caption)
                    .foregroundColor(.cream300)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)

            Button("Maybe later") { onFinish(.later) }
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.cream300)
                .padding(.top, 12)
                .padding(.bottom, 24)
        }
        .padding(.horizontal, 24)
    }

    // MARK: - Pieces

    private func card<Illustration: View>(
        title: String,
        body: String,
        @ViewBuilder illustration: () -> Illustration
    ) -> some View {
        VStack(spacing: Spacing.lg) {
            Spacer()
            illustration()
            Spacer().frame(height: 8)
            Text(title)
                .font(.displayMedium)
                .fontDesign(.serif)
                .foregroundColor(.cream100)
                .multilineTextAlignment(.center)
            Text(body)
                .font(.bodyPrimary)
                .foregroundColor(.cream200)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .padding(.horizontal, 8)
            Spacer()
        }
        .padding(.horizontal, 24)
    }

    private func turnRow(name: String, status: String, active: Bool) -> some View {
        HStack(spacing: 12) {
            AvatarView(initials: String(name.prefix(2)).uppercased(), size: .regular)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.displaySmall)
                    .fontDesign(.serif)
                    .foregroundColor(.cream100)
                Text(status)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(active ? .gold500 : .cream300)
            }
            Spacer()
        }
        .padding(12)
        .background(Color.black.opacity(0.2))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.gold500.opacity(active ? 0.5 : 0.15), lineWidth: 1))
        .cornerRadius(12)
    }

    private let demoHands: [(String, String)] = [
        ("As", "Kd"), ("7h", "2c"), ("Qs", "Qh"), ("9d", "8d"), ("Jc", "4s"), ("Th", "Ts"),
    ]
}

#Preview {
    HowToPlayView { _ in }
}

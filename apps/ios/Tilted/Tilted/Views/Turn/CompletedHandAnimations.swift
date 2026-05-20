import SwiftUI
import UIKit

/// Shared animation primitives used by every "Completed Hand" surface
/// (HandWonView, HandFoldedView, ShowdownResultView, RevealView's
/// runout reveals).

// MARK: - Chip pile slide

/// A small stack of gold chips that slides from the pot center toward
/// the winner's side, along a soft Bezier-style arc. Triggers
/// automatically on appear.
struct ChipPileSlideView: View {
    enum Destination { case me, opponent, split }
    let destination: Destination

    @State private var phase: CGFloat = 0  // 0 → 1

    private var endOffset: CGSize {
        switch destination {
        case .me: return CGSize(width: 0, height: 80)
        case .opponent: return CGSize(width: 0, height: -80)
        case .split: return .zero
        }
    }

    var body: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color.gold500, Color.gold700],
                            center: .center,
                            startRadius: 0,
                            endRadius: 14
                        )
                    )
                    .frame(width: 18, height: 18)
                    .offset(
                        x: CGFloat(i - 1) * 4,
                        y: CGFloat(-i) * 2
                    )
                    .shadow(color: .black.opacity(0.4), radius: 1, y: 1)
            }
        }
        .offset(
            x: endOffset.width * phase,
            // Slight arc — peak ~10pt above the midpoint.
            y: endOffset.height * phase + (sin(phase * .pi) * (destination == .me ? -10 : 10))
        )
        .opacity(destination == .split ? 0.7 : Double(1.0 - phase * 0.2))
        .onAppear {
            withAnimation(.timingCurve(0.22, 1.05, 0.36, 1.0, duration: 0.7)) {
                phase = 1
            }
        }
    }
}

// MARK: - Winner-side glow

/// A soft glow that fades in beneath the winner's hole cards. Used as
/// an overlay (background blendable) on the completion surface.
struct WinnerSideGlow: View {
    let won: Bool

    @State private var visible = false

    var body: some View {
        RadialGradient(
            colors: [
                won ? Color.gold500.opacity(0.35) : Color.claret.opacity(0.25),
                .clear,
            ],
            center: .center,
            startRadius: 10,
            endRadius: 160
        )
        .frame(width: 220, height: 220)
        .opacity(visible ? 1 : 0)
        .onAppear {
            // Brief delay so the chip slide is the first beat.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                withAnimation(.easeOut(duration: 0.5)) { visible = true }
            }
        }
    }
}

// MARK: - Haptic helper

enum CompletedHandHaptics {
    /// Medium impact — used when the user dismisses a Completed Hand
    /// screen. Subtle but tactile.
    static func dismissImpact() {
        let h = UIImpactFeedbackGenerator(style: .medium)
        h.impactOccurred()
    }
}

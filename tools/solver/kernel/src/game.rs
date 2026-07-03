//! Abstract game interface for enumerable two-player zero-sum games with chance.
//!
//! Used by the vanilla CFR+ trainer and the exact best-response calculator.
//! Only the toy validation games (Kuhn, Leduc) and the preflop jam/fold game
//! implement this; full NLHE is trained by the dedicated MCCFR path instead.

/// A two-player zero-sum extensive-form game with chance nodes.
///
/// States must form a tree (no sharing), and players must have perfect recall.
/// Utilities are from player 0's perspective; player 1 receives the negation.
pub trait Game {
    type State: Clone;

    /// The unique root state (may be a chance node).
    fn root(&self) -> Self::State;

    fn is_terminal(&self, s: &Self::State) -> bool;

    /// Utility for player 0 at a terminal state.
    fn utility(&self, s: &Self::State) -> f64;

    fn is_chance(&self, s: &Self::State) -> bool;

    /// Outcomes and probabilities at a chance node. Probabilities sum to 1.
    fn chance_outcomes(&self, s: &Self::State) -> Vec<(Self::State, f64)>;

    /// Player to act at a non-terminal, non-chance state (0 or 1).
    fn to_act(&self, s: &Self::State) -> usize;

    /// Number of legal actions at a decision state.
    fn num_actions(&self, s: &Self::State) -> usize;

    /// Apply action index `a` (0-based over legal actions).
    fn next(&self, s: &Self::State, a: usize) -> Self::State;

    /// Information-set key for the acting player: everything they can observe.
    /// Two states with the same key MUST have the same legal action count.
    fn infoset_key(&self, s: &Self::State) -> String;
}

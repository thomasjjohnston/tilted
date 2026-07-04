//! Kuhn poker: 3 cards (J=0, Q=1, K=2), one card each, ante 1, bet size 1.
//! Game value for player 0 is exactly -1/18 ≈ -0.05556.

use crate::game::Game;

#[derive(Clone, Debug)]
pub struct KuhnState {
    /// None until the chance node deals. (p0 card, p1 card)
    pub cards: Option<(u8, u8)>,
    /// Action history: 'c' = check/call, 'b' = bet, 'f' = fold.
    pub history: String,
}

pub struct Kuhn;

impl KuhnState {
    fn terminal_kind(&self) -> Option<&'static str> {
        match self.history.as_str() {
            "cc" => Some("showdown_1"),   // check-check: pot 1 each
            "bc" => Some("showdown_2"),   // bet-call
            "cbc" => Some("showdown_2"),  // check-bet-call
            "bf" => Some("fold_p1"),      // p1 folds to bet, p0 wins ante
            "cbf" => Some("fold_p0"),     // p0 folds to check-raise... (p0 checked, p1 bet, p0 folds)
            _ => None,
        }
    }
}

impl Game for Kuhn {
    type State = KuhnState;

    fn root(&self) -> KuhnState {
        KuhnState { cards: None, history: String::new() }
    }

    fn is_terminal(&self, s: &KuhnState) -> bool {
        s.cards.is_some() && s.terminal_kind().is_some()
    }

    fn utility(&self, s: &KuhnState) -> f64 {
        let (c0, c1) = s.cards.unwrap();
        let p0_wins = c0 > c1;
        match s.terminal_kind().unwrap() {
            "showdown_1" => if p0_wins { 1.0 } else { -1.0 },
            "showdown_2" => if p0_wins { 2.0 } else { -2.0 },
            "fold_p1" => 1.0,
            "fold_p0" => -1.0,
            _ => unreachable!(),
        }
    }

    fn is_chance(&self, s: &KuhnState) -> bool {
        s.cards.is_none()
    }

    fn chance_outcomes(&self, s: &KuhnState) -> Vec<(KuhnState, f64)> {
        let mut out = Vec::new();
        for c0 in 0..3u8 {
            for c1 in 0..3u8 {
                if c0 != c1 {
                    out.push((
                        KuhnState { cards: Some((c0, c1)), history: s.history.clone() },
                        1.0 / 6.0,
                    ));
                }
            }
        }
        out
    }

    fn to_act(&self, s: &KuhnState) -> usize {
        s.history.len() % 2
    }

    fn num_actions(&self, _s: &KuhnState) -> usize {
        2 // pass (check/fold-or-call... see next()) is action 0, bet/call mapping below
    }

    fn next(&self, s: &KuhnState, a: usize) -> KuhnState {
        // Action 0 = passive (check if no bet pending, fold if facing a bet... but in
        // Kuhn facing a bet the passive action is FOLD and aggressive is CALL).
        // Facing a bet: 0 = fold, 1 = call. No bet: 0 = check, 1 = bet.
        let facing_bet = s.history.ends_with('b');
        let ch = match (facing_bet, a) {
            (false, 0) => 'c',
            (false, 1) => 'b',
            (true, 0) => 'f',
            (true, 1) => 'c',
            _ => unreachable!(),
        };
        let mut h = s.history.clone();
        h.push(ch);
        KuhnState { cards: s.cards, history: h }
    }

    fn infoset_key(&self, s: &KuhnState) -> String {
        let (c0, c1) = s.cards.unwrap();
        let card = if self.to_act(s) == 0 { c0 } else { c1 };
        format!("{}:{}", card, s.history)
    }
}

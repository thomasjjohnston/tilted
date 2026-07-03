//! Leduc hold'em (Southey et al. 2005, OpenSpiel-compatible rules):
//! 6-card deck {J,J,Q,Q,K,K}, ante 1, one private card each, one public card.
//! Round 1 bet size 2, round 2 bet size 4, max two raises per round.
//! Pairing the public card beats everything else; otherwise high card; ties split.
//! Game value for player 0 ≈ -0.0856.

use crate::game::Game;

const RAISE_CAP: u8 = 2;

#[derive(Clone, Debug)]
pub struct LeducState {
    /// Private cards by rank 0..3 (J=0,Q=1,K=2); deck has two of each.
    pub cards: Option<(u8, u8)>,
    /// Public card, dealt between rounds.
    pub board: Option<u8>,
    /// Per-round action strings: 'c' check/call, 'r' raise/bet, 'f' fold.
    pub rounds: [String; 2],
    /// Money each player has put in the pot (includes ante).
    pub committed: [f64; 2],
    /// Whose action it is within the current round.
    pub to_act: usize,
    /// True once the hand has ended by fold.
    pub folded: Option<usize>,
}

pub struct Leduc;

impl LeducState {
    fn round(&self) -> usize {
        if self.board.is_none() { 0 } else { 1 }
    }

    fn round_over(h: &str) -> bool {
        // A betting round ends on: check-check, or any call of a bet ("...rc"),
        // (folds end the hand entirely and are handled via `folded`).
        h == "cc" || (h.len() >= 2 && h.ends_with('c') && h[..h.len() - 1].ends_with('r'))
    }

    fn raises_in(h: &str) -> u8 {
        h.bytes().filter(|&b| b == b'r').count() as u8
    }

    fn facing_raise(h: &str) -> bool {
        h.ends_with('r')
    }
}

impl Game for Leduc {
    type State = LeducState;

    fn root(&self) -> LeducState {
        LeducState {
            cards: None,
            board: None,
            rounds: [String::new(), String::new()],
            committed: [1.0, 1.0],
            to_act: 0,
            folded: None,
        }
    }

    fn is_terminal(&self, s: &LeducState) -> bool {
        if s.cards.is_none() {
            return false;
        }
        if s.folded.is_some() {
            return true;
        }
        s.board.is_some() && LeducState::round_over(&s.rounds[1])
    }

    fn utility(&self, s: &LeducState) -> f64 {
        if let Some(p) = s.folded {
            // Folder loses what they committed.
            return if p == 0 { -s.committed[0] } else { s.committed[1] };
        }
        let (c0, c1) = s.cards.unwrap();
        let b = s.board.unwrap();
        let rank0 = if c0 == b { 100 } else { c0 as i32 };
        let rank1 = if c1 == b { 100 } else { c1 as i32 };
        if rank0 > rank1 {
            s.committed[1]
        } else if rank1 > rank0 {
            -s.committed[0]
        } else {
            0.0
        }
    }

    fn is_chance(&self, s: &LeducState) -> bool {
        if s.cards.is_none() {
            return true;
        }
        // Public card is dealt once round-1 betting closes without a fold.
        s.folded.is_none() && s.board.is_none() && LeducState::round_over(&s.rounds[0])
    }

    fn chance_outcomes(&self, s: &LeducState) -> Vec<(LeducState, f64)> {
        if s.cards.is_none() {
            // Deal private cards. Deck: two copies of each of 3 ranks.
            // Enumerate ordered rank pairs with multiplicity.
            let mut out = Vec::new();
            for c0 in 0..3u8 {
                for c1 in 0..3u8 {
                    let ways = if c0 == c1 { 2.0 * 1.0 } else { 2.0 * 2.0 };
                    let p = ways / (6.0 * 5.0);
                    let mut n = s.clone();
                    n.cards = Some((c0, c1));
                    out.push((n, p));
                }
            }
            out
        } else {
            // Deal the public card from the 4 remaining.
            let (c0, c1) = s.cards.unwrap();
            let mut remaining = [2u8; 3];
            remaining[c0 as usize] -= 1;
            remaining[c1 as usize] -= 1;
            let total: u8 = remaining.iter().sum();
            (0..3u8)
                .filter(|&r| remaining[r as usize] > 0)
                .map(|r| {
                    let mut n = s.clone();
                    n.board = Some(r);
                    n.to_act = 0;
                    (n, remaining[r as usize] as f64 / total as f64)
                })
                .collect()
        }
    }

    fn to_act(&self, s: &LeducState) -> usize {
        s.to_act
    }

    fn num_actions(&self, s: &LeducState) -> usize {
        let r = s.round();
        let h = &s.rounds[r];
        let can_raise = LeducState::raises_in(h) < RAISE_CAP;
        if LeducState::facing_raise(h) {
            if can_raise { 3 } else { 2 } // fold, call, [raise]
        } else {
            if can_raise { 2 } else { 1 } // check, [bet]
        }
    }

    fn next(&self, s: &LeducState, a: usize) -> LeducState {
        let mut n = s.clone();
        let r = s.round();
        let facing = LeducState::facing_raise(&s.rounds[r]);
        let bet_size = if r == 0 { 2.0 } else { 4.0 };
        let me = s.to_act;
        let opp = 1 - me;

        // Map action index to a move.
        // Facing a raise: 0=fold, 1=call, 2=raise. Not facing: 0=check, 1=bet.
        if facing {
            match a {
                0 => {
                    n.folded = Some(me);
                    n.rounds[r].push('f');
                    return n;
                }
                1 => {
                    n.committed[me] = n.committed[opp];
                    n.rounds[r].push('c');
                }
                2 => {
                    n.committed[me] = n.committed[opp] + bet_size;
                    n.rounds[r].push('r');
                }
                _ => unreachable!(),
            }
        } else {
            match a {
                0 => {
                    n.rounds[r].push('c');
                }
                1 => {
                    n.committed[me] = n.committed[opp] + bet_size;
                    n.rounds[r].push('r');
                }
                _ => unreachable!(),
            }
        }
        n.to_act = opp;
        n
    }

    fn infoset_key(&self, s: &LeducState) -> String {
        let (c0, c1) = s.cards.unwrap();
        let card = if s.to_act == 0 { c0 } else { c1 };
        let board = s.board.map(|b| b.to_string()).unwrap_or_else(|| "-".into());
        format!("{}|{}|{}/{}", card, board, s.rounds[0], s.rounds[1])
    }
}

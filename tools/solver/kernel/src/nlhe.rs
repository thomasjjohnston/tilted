//! Heads-up no-limit hold'em abstract game: config, betting state machine,
//! and card abstraction (E[HS] percentile buckets).
//!
//! Chip conventions match Tilted: blinds 5/10, integer chips, player 0 = SB/BTN
//! (acts first preflop, second postflop), player 1 = BB.

use crate::cards::{preflop_class, Card};
use crate::equity::expected_hand_strength;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub const STREETS: [&str; 4] = ["preflop", "flop", "turn", "river"];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BetMenuConfig {
    /// SB open sizes, as multiples of the big blind (e.g. 2.5 -> raise to 25).
    pub preflop_opens: Vec<f64>,
    /// Re-raise sizes preflop, as multiples of the bet being raised.
    pub preflop_raises: Vec<f64>,
    /// Bet/raise sizes per postflop street, as fractions of pot.
    pub flop: Vec<f64>,
    pub turn: Vec<f64>,
    pub river: Vec<f64>,
    /// Overbet sizes appended on `overbet_streets` when depth >= overbet_min_depth_bb.
    pub overbet: Vec<f64>,
    pub overbet_min_depth_bb: u32,
    pub overbet_streets: Vec<String>,
    /// Drop any size whose raise-to lands within this fraction of all-in.
    pub near_allin_prune: f64,
    /// Max raises per street before only call/fold/all-in remain.
    pub raise_cap: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BucketConfig {
    pub flop: usize,
    pub turn: usize,
    pub river: usize,
    /// Monte Carlo samples per E[HS] evaluation.
    pub ehs_samples: u32,
    /// Situations sampled per street when building percentile boundaries.
    pub boundary_samples: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NlheConfig {
    pub blind_small: u32,
    pub blind_big: u32,
    pub bet_menus: BetMenuConfig,
    pub buckets: BucketConfig,
}

impl Default for NlheConfig {
    fn default() -> Self {
        NlheConfig {
            blind_small: 5,
            blind_big: 10,
            bet_menus: BetMenuConfig {
                preflop_opens: vec![2.5],
                preflop_raises: vec![3.0],
                flop: vec![0.33, 0.75],
                turn: vec![0.75, 1.25],
                river: vec![0.75, 1.25],
                overbet: vec![2.0],
                overbet_min_depth_bb: 100,
                overbet_streets: vec!["turn".into(), "river".into()],
                near_allin_prune: 0.25,
                raise_cap: 3,
            },
            buckets: BucketConfig {
                flop: 200,
                turn: 200,
                river: 200,
                ehs_samples: 96,
                boundary_samples: 100_000,
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Action tokens
// ---------------------------------------------------------------------------

/// Action tokens (4 bits each) as packed into the betting-sequence key.
/// 0 = fold, 1 = check/call, 2..=13 = menu size index, 14 = all-in,
/// 15 = street separator.
pub const TOK_FOLD: u8 = 0;
pub const TOK_CALL: u8 = 1;
pub const TOK_ALLIN: u8 = 14;
pub const TOK_STREET: u8 = 15;
pub const MAX_TOKENS: usize = 32;

pub fn token_name(tok: u8) -> String {
    match tok {
        TOK_FOLD => "f".into(),
        TOK_CALL => "c".into(),
        TOK_ALLIN => "a".into(),
        TOK_STREET => "/".into(),
        n => format!("r{}", n - 2),
    }
}

pub fn seq_to_string(seq: &[u8]) -> String {
    seq.iter().map(|&t| token_name(t)).collect::<Vec<_>>().join("")
}

pub fn seq_from_string(s: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            'f' => out.push(TOK_FOLD),
            'c' => out.push(TOK_CALL),
            'a' => out.push(TOK_ALLIN),
            '/' => out.push(TOK_STREET),
            'r' => {
                let mut num = String::new();
                while let Some(d) = chars.peek().filter(|d| d.is_ascii_digit()) {
                    num.push(*d);
                    chars.next();
                }
                let idx: u8 = num.parse().map_err(|_| format!("bad raise token in {s}"))?;
                out.push(2 + idx);
            }
            other => return Err(format!("bad token char '{other}' in {s}")),
        }
    }
    Ok(out)
}

/// Pack a token sequence into a u128 (4 bits per token, sentinel-terminated).
pub fn pack_seq(seq: &[u8]) -> u128 {
    debug_assert!(seq.len() <= MAX_TOKENS);
    let mut v: u128 = 0;
    for (i, &t) in seq.iter().enumerate() {
        v |= (t as u128 & 0xF) << (i * 4);
    }
    // Length in the top bits to distinguish "f" from "f + trailing zeros".
    v | ((seq.len() as u128) << 122)
}

// ---------------------------------------------------------------------------
// Betting state machine
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Terminal {
    /// `usize` = the player who folded.
    Fold(usize),
    Showdown,
}

#[derive(Clone, Debug)]
pub struct BetState {
    /// Effective stack (chips) both players start the hand with.
    pub stack: u32,
    pub street: usize,
    /// Total chips committed across all streets, per player.
    pub committed: [u32; 2],
    /// Chips committed on the current street ("bet to" amount), per player.
    pub street_to: [u32; 2],
    /// Last raise increment on this street (min-raise rule).
    pub last_raise: u32,
    pub raises_this_street: u8,
    pub acted: [bool; 2],
    pub to_act: usize,
    pub terminal: Option<Terminal>,
    /// Full token history including street separators.
    pub seq: Vec<u8>,
}

/// A legal action at a state: its token and the resulting total street commitment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LegalAction {
    pub token: u8,
    /// The "bet to" amount on this street after taking the action (0 for fold).
    pub to: u32,
}

impl BetState {
    pub fn new(config: &NlheConfig, depth_bb: u32) -> Self {
        let stack = depth_bb * config.blind_big;
        BetState {
            stack,
            street: 0,
            committed: [config.blind_small, config.blind_big],
            street_to: [config.blind_small, config.blind_big],
            last_raise: config.blind_big - config.blind_small,
            raises_this_street: 0,
            acted: [false, false],
            to_act: 0, // SB first preflop
            terminal: None,
            seq: Vec::new(),
        }
    }

    pub fn pot(&self) -> u32 {
        self.committed[0] + self.committed[1]
    }

    fn is_all_in(&self, p: usize) -> bool {
        self.committed[p] >= self.stack
    }

    /// Menu of raise sizes for the current state, resolved to "to" amounts.
    /// Returns (menu_index, to) pairs; indices are stable positions in the
    /// configured size list so tokens are stable across states.
    fn menu(&self, config: &NlheConfig, depth_bb: u32) -> Vec<(usize, u32)> {
        let m = &config.bet_menus;
        let facing = self.street_to[1 - self.to_act] > self.street_to[self.to_act];
        let opp_to = self.street_to[1 - self.to_act];
        let pot0 = self.pot();
        let call_amount = opp_to.saturating_sub(self.street_to[self.to_act]);
        let pot_if_call = pot0 + call_amount;

        let mut sizes: Vec<f64> = Vec::new();
        let street_name = STREETS[self.street];
        if self.street == 0 {
            if self.raises_this_street == 0 && self.to_act == 0 && !facing {
                // Can't happen: SB always faces the BB "bet" preflop.
                sizes = m.preflop_opens.clone();
            } else if self.raises_this_street == 0 {
                // SB opening over the blind, or BB raising a limp.
                sizes = m.preflop_opens.clone();
            } else {
                sizes = m.preflop_raises.clone();
            }
        } else {
            let base = match self.street {
                1 => &m.flop,
                2 => &m.turn,
                _ => &m.river,
            };
            sizes.extend(base.iter().copied());
            if depth_bb >= m.overbet_min_depth_bb && m.overbet_streets.iter().any(|s| s == street_name) {
                sizes.extend(m.overbet.iter().copied());
            }
        }

        let mut out = Vec::new();
        for (i, &size) in sizes.iter().enumerate() {
            let raw_to = if self.street == 0 {
                if self.raises_this_street == 0 {
                    // Open: multiple of the big blind.
                    (size * config.blind_big as f64).round() as u32
                } else {
                    // Re-raise: multiple of the opponent's current bet-to.
                    (size * opp_to as f64).round() as u32
                }
            } else if !facing {
                // Bet: fraction of pot.
                (size * pot0 as f64).round() as u32
            } else {
                // Raise: opponent's bet plus fraction of the pot-after-call.
                opp_to + (size * pot_if_call as f64).round() as u32
            };
            // Round to 5-chip granularity (blind quantum).
            let mut to = ((raw_to + 2) / 5) * 5;
            // Enforce minimums: min bet = 1 BB; min raise = last raise increment.
            let min_to = if facing || self.street == 0 {
                opp_to + self.last_raise.max(config.blind_big)
            } else {
                config.blind_big
            };
            to = to.max(min_to);
            // Cap at all-in; prune sizes near all-in (all-in token covers them).
            let allin_to = self.allin_to();
            if (to as f64) >= (1.0 - m.near_allin_prune) * allin_to as f64 {
                continue;
            }
            out.push((i, to));
        }
        // Dedup identical amounts (rounding can collide) keeping the first.
        let mut seen = Vec::new();
        out.retain(|&(_, to)| {
            if seen.contains(&to) {
                false
            } else {
                seen.push(to);
                true
            }
        });
        out
    }

    /// The street "to" amount that puts the acting player all-in.
    fn allin_to(&self) -> u32 {
        self.stack - (self.committed[self.to_act] - self.street_to[self.to_act])
    }

    /// All legal actions at this state, in stable token order.
    pub fn legal_actions(&self, config: &NlheConfig, depth_bb: u32) -> Vec<LegalAction> {
        assert!(self.terminal.is_none(), "no actions at a terminal state");
        let me = self.to_act;
        let opp = 1 - me;
        let facing = self.street_to[opp] > self.street_to[me];
        let mut out = Vec::new();

        if facing {
            out.push(LegalAction { token: TOK_FOLD, to: 0 });
        }
        // Check (not facing) or call (facing). Calling an all-in larger than my
        // stack is a call-for-less (capped at my all-in).
        let call_to = self.street_to[opp].min(self.allin_to());
        out.push(LegalAction { token: TOK_CALL, to: call_to });

        // Raises: only if opponent isn't all-in, cap not reached, room in seq.
        let opp_all_in = self.committed[opp] >= self.stack;
        if !opp_all_in && self.seq.len() < MAX_TOKENS - 2 {
            if self.raises_this_street < config.bet_menus.raise_cap {
                for (i, to) in self.menu(config, depth_bb) {
                    if to > self.street_to[opp] && to < self.allin_to() {
                        out.push(LegalAction { token: 2 + i as u8, to });
                    }
                }
            }
            let allin = self.allin_to();
            if allin > self.street_to[opp] {
                out.push(LegalAction { token: TOK_ALLIN, to: allin });
            }
        }
        out
    }

    /// Apply an action, advancing streets as needed.
    pub fn apply(&mut self, action: LegalAction) {
        let me = self.to_act;
        let opp = 1 - me;
        self.seq.push(action.token);

        match action.token {
            TOK_FOLD => {
                self.terminal = Some(Terminal::Fold(me));
                return;
            }
            TOK_CALL => {
                let delta = action.to - self.street_to[me];
                self.street_to[me] = action.to;
                self.committed[me] += delta;
                self.acted[me] = true;
            }
            _ => {
                // Raise / bet / all-in.
                let delta = action.to - self.street_to[me];
                let increment = action.to.saturating_sub(self.street_to[opp]);
                self.street_to[me] = action.to;
                self.committed[me] += delta;
                self.acted[me] = true;
                // A short all-in (less than a full raise) doesn't reopen betting;
                // for simplicity we still track it as the last raise if larger.
                if increment > self.last_raise {
                    self.last_raise = increment;
                }
                self.raises_this_street += 1;
            }
        }

        // Street over? Both have acted and the amounts are matched. A raise
        // never closes a street (the opponent must respond); a call or check
        // closes it once both players have acted. A call-for-less (all-in)
        // also closes action even though the nominal amounts differ.
        let matched = self.street_to[me] == self.street_to[opp]
            || self.is_all_in(me)
            || self.is_all_in(opp);
        let closing_action = action.token == TOK_CALL;
        if closing_action && self.acted[me] && self.acted[opp] && matched {
            let someone_all_in = self.is_all_in(0) || self.is_all_in(1);
            if self.street == 3 || someone_all_in {
                self.terminal = Some(Terminal::Showdown);
            } else {
                self.street += 1;
                self.street_to = [0, 0];
                self.last_raise = 0;
                self.raises_this_street = 0;
                self.acted = [false, false];
                self.to_act = 1; // BB acts first postflop
                self.seq.push(TOK_STREET);
            }
            return;
        }
        self.to_act = opp;
    }

    /// Net utility for player 0 at a terminal state, given a showdown comparator
    /// (returns >0 if player 0's hand wins, 0 tie, <0 if player 1 wins).
    pub fn utility_p0(&self, showdown_cmp: impl Fn() -> i32) -> f64 {
        match self.terminal.expect("utility at non-terminal") {
            Terminal::Fold(loser) => {
                if loser == 0 {
                    -(self.committed[0].min(self.committed[1]) as f64)
                } else {
                    self.committed[0].min(self.committed[1]) as f64
                }
            }
            Terminal::Showdown => {
                let pot_each = self.committed[0].min(self.committed[1]) as f64;
                match showdown_cmp() {
                    x if x > 0 => pot_each,
                    0 => 0.0,
                    _ => -pot_each,
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Card abstraction: E[HS] percentile buckets
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Buckets {
    /// Sorted E[HS] boundaries per postflop street; bucket = count of
    /// boundaries below the hand's E[HS]. Preflop uses the 169 classes.
    pub flop: Vec<f64>,
    pub turn: Vec<f64>,
    pub river: Vec<f64>,
    pub ehs_samples: u32,
}

impl Buckets {
    pub fn n_buckets(&self, street: usize) -> usize {
        match street {
            0 => 169,
            1 => self.flop.len() + 1,
            2 => self.turn.len() + 1,
            _ => self.river.len() + 1,
        }
    }

    pub fn assign(&self, street: usize, hole: [Card; 2], board: &[Card]) -> u16 {
        if street == 0 {
            return preflop_class(hole[0], hole[1]) as u16;
        }
        let ehs = deterministic_ehs(hole, board, self.ehs_samples);
        let bounds = match street {
            1 => &self.flop,
            2 => &self.turn,
            _ => &self.river,
        };
        bounds.partition_point(|&b| b < ehs) as u16
    }
}

/// E[HS] with an RNG seeded from the cards themselves, so the same
/// (hole, board) always maps to the same bucket — in the trainer, in the
/// Python advisor, and in conformance tests.
pub fn deterministic_ehs(hole: [Card; 2], board: &[Card], samples: u32) -> f64 {
    use rand::SeedableRng;
    let mut hasher = DefaultHasher::new();
    hole.hash(&mut hasher);
    board.hash(&mut hasher);
    let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(hasher.finish());
    expected_hand_strength(hole, board, samples, &mut rng)
}

/// Build percentile boundaries per street from uniformly sampled situations.
pub fn build_buckets(config: &BucketConfig, seed: u64) -> Buckets {
    use rand::seq::SliceRandom;
    use rand::SeedableRng;
    use rayon::prelude::*;

    let build_street = |board_len: usize, n_buckets: usize| -> Vec<f64> {
        let samples: Vec<f64> = (0..config.boundary_samples)
            .into_par_iter()
            .map(|i| {
                let mut rng =
                    rand_chacha::ChaCha8Rng::seed_from_u64(seed ^ ((board_len as u64) << 32) ^ i as u64);
                let mut deck: Vec<Card> = (0..52).collect();
                deck.shuffle(&mut rng);
                let hole = [deck[0], deck[1]];
                let board = &deck[2..2 + board_len];
                expected_hand_strength(hole, board, config.ehs_samples, &mut rng)
            })
            .collect();
        let mut sorted = samples;
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        (1..n_buckets)
            .map(|i| sorted[i * sorted.len() / n_buckets])
            .collect()
    };

    Buckets {
        flop: build_street(3, config.flop),
        turn: build_street(4, config.turn),
        river: build_street(5, config.river),
        ehs_samples: config.ehs_samples,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::parse_cards;

    fn cfg() -> NlheConfig {
        NlheConfig::default()
    }

    #[test]
    fn preflop_open_and_call_advances_to_flop() {
        let c = cfg();
        let mut s = BetState::new(&c, 100);
        // SB opens 2.5bb.
        let acts = s.legal_actions(&c, 100);
        let open = acts.iter().find(|a| a.token == 2).expect("open available");
        assert_eq!(open.to, 25);
        s.apply(*open);
        assert_eq!(s.to_act, 1);
        // BB calls -> flop.
        let acts = s.legal_actions(&c, 100);
        let call = acts.iter().find(|a| a.token == TOK_CALL).unwrap();
        s.apply(*call);
        assert_eq!(s.street, 1);
        assert_eq!(s.to_act, 1, "BB acts first postflop");
        assert_eq!(s.pot(), 50);
        assert_eq!(s.committed, [25, 25]);
        assert!(s.seq.ends_with(&[TOK_STREET]));
    }

    #[test]
    fn limp_gives_bb_option() {
        let c = cfg();
        let mut s = BetState::new(&c, 100);
        let acts = s.legal_actions(&c, 100);
        let call = acts.iter().find(|a| a.token == TOK_CALL).unwrap();
        assert_eq!(call.to, 10);
        s.apply(*call); // SB limps
        assert_eq!(s.street, 0, "BB still has the option");
        assert_eq!(s.to_act, 1);
        // BB checks -> flop.
        let acts = s.legal_actions(&c, 100);
        assert!(!acts.iter().any(|a| a.token == TOK_FOLD), "BB not facing a bet");
        let check = acts.iter().find(|a| a.token == TOK_CALL).unwrap();
        s.apply(*check);
        assert_eq!(s.street, 1);
        assert_eq!(s.pot(), 20);
    }

    #[test]
    fn fold_is_terminal_with_correct_utility() {
        let c = cfg();
        let mut s = BetState::new(&c, 100);
        let acts = s.legal_actions(&c, 100);
        s.apply(*acts.iter().find(|a| a.token == TOK_FOLD).unwrap());
        assert_eq!(s.terminal, Some(Terminal::Fold(0)));
        // SB folded: loses the 5-chip small blind.
        assert_eq!(s.utility_p0(|| 0), -5.0);
    }

    #[test]
    fn allin_call_reaches_showdown_and_freezes_stack() {
        let c = cfg();
        let mut s = BetState::new(&c, 25); // 250 chips
        let acts = s.legal_actions(&c, 25);
        let jam = acts.iter().find(|a| a.token == TOK_ALLIN).unwrap();
        assert_eq!(jam.to, 250);
        s.apply(*jam);
        let acts = s.legal_actions(&c, 25);
        assert_eq!(acts.len(), 2, "facing a jam: fold or call only, got {acts:?}");
        s.apply(*acts.iter().find(|a| a.token == TOK_CALL).unwrap());
        assert_eq!(s.terminal, Some(Terminal::Showdown));
        assert_eq!(s.committed, [250, 250]);
        assert_eq!(s.utility_p0(|| 1), 250.0);
        assert_eq!(s.utility_p0(|| -1), -250.0);
        assert_eq!(s.utility_p0(|| 0), 0.0);
    }

    #[test]
    fn min_raise_rule_enforced() {
        let c = cfg();
        let mut s = BetState::new(&c, 100);
        let acts = s.legal_actions(&c, 100);
        let open = acts.iter().find(|a| a.token == 2).unwrap(); // to 25
        s.apply(*open);
        // BB's re-raise menu: every raise must be at least to 40 (25 + 15 increment).
        let acts = s.legal_actions(&c, 100);
        for a in &acts {
            if a.token >= 2 && a.token != TOK_ALLIN {
                assert!(a.to >= 40, "raise to {} violates min-raise", a.to);
            }
        }
    }

    #[test]
    fn overbets_only_deep_and_only_on_configured_streets() {
        let c = cfg();
        // Reach the turn with a small pot at 200bb: overbet should appear.
        let mut s = BetState::new(&c, 200);
        let acts = s.legal_actions(&c, 200);
        s.apply(*acts.iter().find(|a| a.token == TOK_CALL).unwrap()); // limp
        let acts = s.legal_actions(&c, 200);
        s.apply(*acts.iter().find(|a| a.token == TOK_CALL).unwrap()); // check
        // Flop: check-check.
        for _ in 0..2 {
            let acts = s.legal_actions(&c, 200);
            s.apply(*acts.iter().find(|a| a.token == TOK_CALL).unwrap());
        }
        assert_eq!(s.street, 2, "on the turn");
        // Turn menu (pot 20): fracs 0.75, 1.25 plus overbet 2.0 -> bets 15, 25, 40.
        let acts = s.legal_actions(&c, 200);
        let bet_tos: Vec<u32> = acts.iter().filter(|a| a.token >= 2 && a.token != TOK_ALLIN).map(|a| a.to).collect();
        assert!(bet_tos.contains(&40), "2x-pot overbet missing from turn menu at 200bb: {bet_tos:?}");
        // Same spot at 60bb: no overbet.
        let mut s2 = BetState::new(&c, 60);
        for _ in 0..4 {
            let acts = s2.legal_actions(&c, 60);
            s2.apply(*acts.iter().find(|a| a.token == TOK_CALL).unwrap());
        }
        let acts = s2.legal_actions(&c, 60);
        let bet_tos: Vec<u32> = acts.iter().filter(|a| a.token >= 2 && a.token != TOK_ALLIN).map(|a| a.to).collect();
        assert!(!bet_tos.contains(&40), "overbet should be absent below 100bb: {bet_tos:?}");
    }

    #[test]
    fn chip_conservation_through_random_playouts() {
        use rand::Rng;
        use rand::SeedableRng;
        let c = cfg();
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(9);
        for depth in [10u32, 25, 60, 100, 200] {
            for _ in 0..500 {
                let mut s = BetState::new(&c, depth);
                while s.terminal.is_none() {
                    let acts = s.legal_actions(&c, depth);
                    assert!(!acts.is_empty(), "no legal actions at non-terminal state");
                    let a = acts[rng.gen_range(0..acts.len())];
                    s.apply(a);
                    assert!(s.committed[0] <= s.stack && s.committed[1] <= s.stack);
                    assert!(s.seq.len() <= MAX_TOKENS, "seq overflow: {}", seq_to_string(&s.seq));
                }
                // Terminal utility is bounded by the effective stack.
                let u = s.utility_p0(|| 1);
                assert!(u.abs() <= s.stack as f64);
            }
        }
    }

    #[test]
    fn seq_roundtrip() {
        let c = cfg();
        let mut s = BetState::new(&c, 100);
        let acts = s.legal_actions(&c, 100);
        s.apply(*acts.iter().find(|a| a.token == 2).unwrap());
        let acts = s.legal_actions(&c, 100);
        s.apply(*acts.iter().find(|a| a.token == TOK_CALL).unwrap());
        let str_form = seq_to_string(&s.seq);
        assert_eq!(seq_from_string(&str_form).unwrap(), s.seq);
    }

    #[test]
    fn bucket_assignment_is_deterministic_and_monotone() {
        let bconf = BucketConfig { flop: 50, turn: 50, river: 50, ehs_samples: 64, boundary_samples: 2_000 };
        let buckets = build_buckets(&bconf, 11);
        assert_eq!(buckets.n_buckets(1), 50);
        let nuts: [Card; 2] = parse_cards("Ah Kh").unwrap().try_into().unwrap();
        let board = parse_cards("Qh Jh Th").unwrap();
        let b1 = buckets.assign(1, nuts, &board);
        let b2 = buckets.assign(1, nuts, &board);
        assert_eq!(b1, b2, "same cards must always land in the same bucket");
        // Royal flush should be in (nearly) the top bucket; 72o on that board near the bottom.
        assert!(b1 as usize >= 45, "royal flush should be in the top buckets, got {b1}");
        let trash: [Card; 2] = parse_cards("7c 2d").unwrap().try_into().unwrap();
        let b3 = buckets.assign(1, trash, &board);
        assert!(b3 < b1, "72o must bucket below a royal flush");
    }
}

//! Equity and hand-strength computation (Monte Carlo).

use crate::cards::{preflop_class, Card};
use crate::eval::eval7;
use rand::seq::SliceRandom;
use rand::Rng;
use rayon::prelude::*;

/// Deal helper: a deck with some cards removed.
pub fn remaining_deck(dead: &[Card]) -> Vec<Card> {
    let mut dead_mask = [false; 52];
    for &c in dead {
        dead_mask[c as usize] = true;
    }
    (0..52).filter(|&c| !dead_mask[c as usize]).collect()
}

/// E[HS]: expected hand strength of `hole` on `board` (0..5 cards) vs a uniform
/// random opponent hand, over uniformly sampled runouts. Returns win + tie/2.
pub fn expected_hand_strength<R: Rng>(hole: [Card; 2], board: &[Card], samples: u32, rng: &mut R) -> f64 {
    let mut dead = vec![hole[0], hole[1]];
    dead.extend_from_slice(board);
    let deck = remaining_deck(&dead);
    let need = 5 - board.len();
    let mut total = 0.0;
    let mut my7 = [0u8; 7];
    let mut opp7 = [0u8; 7];
    my7[0] = hole[0];
    my7[1] = hole[1];
    for (i, &b) in board.iter().enumerate() {
        my7[2 + i] = b;
        opp7[2 + i] = b;
    }
    let mut draw = deck.clone();
    for _ in 0..samples {
        // Partial Fisher-Yates: draw `need + 2` cards (runout + opponent hole).
        for i in 0..(need + 2) {
            let j = rng.gen_range(i..draw.len());
            draw.swap(i, j);
        }
        for i in 0..need {
            my7[2 + board.len() + i] = draw[i];
            opp7[2 + board.len() + i] = draw[i];
        }
        opp7[0] = draw[need];
        opp7[1] = draw[need + 1];
        let (me, opp) = (eval7(&my7), eval7(&opp7));
        if me > opp {
            total += 1.0;
        } else if me == opp {
            total += 0.5;
        }
    }
    total / samples as f64
}

/// Preflop all-in equity of every class vs every class: 169x169 matrix of
/// P(win) + P(tie)/2 for the row class vs the column class.
/// Monte Carlo over concrete combos and boards; symmetric up to sampling noise.
pub fn preflop_equity_table(samples_per_pair: u32, seed: u64) -> Vec<Vec<f64>> {
    // For each class pick all concrete representative combos; sample a combo
    // pair (non-conflicting) then a board.
    let combos_by_class: Vec<Vec<[Card; 2]>> = {
        let mut v: Vec<Vec<[Card; 2]>> = vec![Vec::new(); 169];
        for a in 0..52u8 {
            for b in (a + 1)..52u8 {
                v[preflop_class(a, b) as usize].push([a, b]);
            }
        }
        v
    };

    let mut table: Vec<Vec<f64>> = (0..169usize)
        .into_par_iter()
        .map(|ci| {
            use rand::SeedableRng;
            let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(seed ^ (ci as u64) << 16);
            let mut row = vec![0.0f64; 169];
            // Only compute the upper triangle (cj >= ci); mirror below.
            for cj in ci..169usize {
                let mut total = 0.0;
                let mut n = 0u32;
                while n < samples_per_pair {
                    let ha = combos_by_class[ci][rng.gen_range(0..combos_by_class[ci].len())];
                    let hb = combos_by_class[cj][rng.gen_range(0..combos_by_class[cj].len())];
                    if ha[0] == hb[0] || ha[0] == hb[1] || ha[1] == hb[0] || ha[1] == hb[1] {
                        continue; // conflicting combos: resample
                    }
                    let deck = remaining_deck(&[ha[0], ha[1], hb[0], hb[1]]);
                    let board: Vec<Card> = deck.choose_multiple(&mut rng, 5).copied().collect();
                    let a7 = [ha[0], ha[1], board[0], board[1], board[2], board[3], board[4]];
                    let b7 = [hb[0], hb[1], board[0], board[1], board[2], board[3], board[4]];
                    let (ea, eb) = (eval7(&a7), eval7(&b7));
                    if ea > eb {
                        total += 1.0;
                    } else if ea == eb {
                        total += 0.5;
                    }
                    n += 1;
                }
                row[cj] = total / samples_per_pair as f64;
            }
            row
        })
        .collect();
    // Enforce exact zero-sum symmetry: e[j][i] = 1 - e[i][j]. Without this,
    // independent sampling noise makes exploitability estimates inconsistent
    // (it can even go slightly negative). Mirror-image classes (ci == cj) are
    // exactly 0.5 by symmetry.
    for ci in 0..169 {
        table[ci][ci] = 0.5;
        for cj in (ci + 1)..169 {
            table[cj][ci] = 1.0 - table[ci][cj];
        }
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::{parse_card, preflop_class, preflop_class_name};
    use rand::SeedableRng;

    #[test]
    fn aa_dominates_random() {
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(1);
        let hole = [parse_card("Ah").unwrap(), parse_card("As").unwrap()];
        let ehs = expected_hand_strength(hole, &[], 5000, &mut rng);
        assert!(ehs > 0.80 && ehs < 0.90, "AA vs random preflop should be ~0.85, got {ehs}");
    }

    #[test]
    fn seven_deuce_is_weak() {
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(2);
        let hole = [parse_card("7h").unwrap(), parse_card("2c").unwrap()];
        let ehs = expected_hand_strength(hole, &[], 5000, &mut rng);
        assert!(ehs > 0.28 && ehs < 0.42, "72o vs random preflop should be ~0.35, got {ehs}");
    }

    #[test]
    fn nuts_on_river_is_certain() {
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(3);
        // Royal flush holding on a board where it's the pure nuts.
        let hole = [parse_card("Ah").unwrap(), parse_card("Kh").unwrap()];
        let board: Vec<_> = ["Qh", "Jh", "Th", "2c", "3d"].iter().map(|s| parse_card(s).unwrap()).collect();
        let ehs = expected_hand_strength(hole, &board, 1000, &mut rng);
        assert!(ehs == 1.0, "royal flush should have EHS exactly 1.0, got {ehs}");
    }

    #[test]
    fn preflop_equity_classics() {
        // Small sample table just for the classic matchups; keep test fast.
        let table = preflop_equity_table(3000, 7);
        let idx = |a: &str, b: &str| -> usize {
            preflop_class(parse_card(a).unwrap(), parse_card(b).unwrap()) as usize
        };
        let aa = idx("Ah", "As");
        let kk = idx("Kh", "Ks");
        let aks = idx("Ah", "Kh");
        assert_eq!(preflop_class_name(aa as u8), "AA");
        // AA vs KK ≈ 0.82
        assert!((table[aa][kk] - 0.82).abs() < 0.03, "AA vs KK ≈ 0.82, got {}", table[aa][kk]);
        // AKs vs AA ≈ 0.12
        assert!((table[aks][aa] - 0.12).abs() < 0.03, "AKs vs AA ≈ 0.12, got {}", table[aks][aa]);
        // Approximate symmetry: e(a,b) + e(b,a) ≈ 1
        assert!((table[aa][kk] + table[kk][aa] - 1.0).abs() < 0.03);
    }
}

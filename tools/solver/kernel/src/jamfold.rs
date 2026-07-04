//! Exact heads-up preflop jam/fold game over the 169 hand classes.
//!
//! SB may jam (all-in) or fold; BB may call or fold. The game is small enough
//! to solve directly in vector form: regret matching on two 169-dimensional
//! strategy vectors with exact expected values via the class-pair weight
//! matrix. Converges in a few thousand iterations, in seconds.
//!
//! This is a validation vehicle: its equilibrium is well-published (Nash
//! push/fold charts), so it anchors the card/equity/CFR stack end to end.

use crate::cards::preflop_class;

/// Joint chance weights over ordered class pairs, accounting for card removal:
/// weight[ci][cj] ∝ number of non-conflicting concrete combo pairs.
pub fn class_pair_weights() -> Vec<Vec<f64>> {
    let mut combos: Vec<Vec<[u8; 2]>> = vec![Vec::new(); 169];
    for a in 0..52u8 {
        for b in (a + 1)..52u8 {
            combos[preflop_class(a, b) as usize].push([a, b]);
        }
    }
    let mut w = vec![vec![0.0f64; 169]; 169];
    for ci in 0..169 {
        for cj in 0..169 {
            let mut count = 0u32;
            for ha in &combos[ci] {
                for hb in &combos[cj] {
                    if ha[0] != hb[0] && ha[0] != hb[1] && ha[1] != hb[0] && ha[1] != hb[1] {
                        count += 1;
                    }
                }
            }
            w[ci][cj] = count as f64;
        }
    }
    let total: f64 = w.iter().flatten().sum();
    for row in &mut w {
        for v in row.iter_mut() {
            *v /= total;
        }
    }
    w
}

pub struct JamFoldSolution {
    /// P(jam) per SB class.
    pub jam: Vec<f64>,
    /// P(call | facing jam) per BB class.
    pub call: Vec<f64>,
    /// Game value for the SB (chips per hand).
    pub value_sb: f64,
    /// Exact exploitability (chips per hand); ~0 at equilibrium.
    pub exploitability: f64,
}

/// Solve the jam/fold game at `stack` chips with regret matching+.
///
/// `equity[i][j]` = all-in equity of class i vs class j;
/// `weights[i][j]` = joint deal probability of (SB=i, BB=j).
pub fn solve(
    stack: f64,
    blind_small: f64,
    blind_big: f64,
    equity: &[Vec<f64>],
    weights: &[Vec<f64>],
    iterations: u32,
) -> JamFoldSolution {
    let n = 169usize;
    // Marginal deal probability per SB class, and conditionals P(j | i).
    let p_sb: Vec<f64> = (0..n).map(|i| weights[i].iter().sum()).collect();

    // Showdown value for the SB when called: 2S * eq - S.
    let sd_sb = |i: usize, j: usize| 2.0 * stack * equity[i][j] - stack;

    let mut regret_jam = vec![[0.0f64; 2]; n]; // [fold, jam] per SB class
    let mut regret_call = vec![[0.0f64; 2]; n]; // [fold, call] per BB class
    let mut sum_jam = vec![0.0f64; n];
    let mut sum_call = vec![0.0f64; n];
    let mut sum_w = 0.0f64;

    let rm = |r: &[f64; 2]| -> f64 {
        // Probability of the second action (jam / call) under regret matching+.
        let (a, b) = (r[0].max(0.0), r[1].max(0.0));
        if a + b > 1e-12 {
            b / (a + b)
        } else {
            0.5
        }
    };

    for t in 1..=iterations {
        let jam: Vec<f64> = regret_jam.iter().map(rm).collect();
        let call: Vec<f64> = regret_call.iter().map(rm).collect();

        // --- SB regrets: value of jam vs fold per class i.
        for i in 0..n {
            if p_sb[i] <= 0.0 {
                continue;
            }
            let mut v_jam = 0.0;
            for j in 0..n {
                let pj = weights[i][j] / p_sb[i];
                if pj <= 0.0 {
                    continue;
                }
                v_jam += pj * ((1.0 - call[j]) * blind_big + call[j] * sd_sb(i, j));
            }
            let v_fold = -blind_small;
            let ev = jam[i] * v_jam + (1.0 - jam[i]) * v_fold;
            // Weight regrets by the class's deal probability (counterfactual reach).
            regret_jam[i][0] = (regret_jam[i][0] + p_sb[i] * (v_fold - ev)).max(0.0);
            regret_jam[i][1] = (regret_jam[i][1] + p_sb[i] * (v_jam - ev)).max(0.0);
        }

        // --- BB regrets: value of call vs fold per class j, given SB jam range.
        for j in 0..n {
            let mut reach = 0.0; // P(SB jams and BB holds j)
            let mut v_call_num = 0.0;
            for i in 0..n {
                let w = weights[i][j] * jam[i];
                reach += w;
                v_call_num += w * (2.0 * stack * equity[j][i] - stack);
            }
            if reach <= 1e-15 {
                continue;
            }
            let v_call = v_call_num / reach;
            let v_fold = -blind_big;
            let ev = call[j] * v_call + (1.0 - call[j]) * v_fold;
            regret_call[j][0] = (regret_call[j][0] + reach * (v_fold - ev)).max(0.0);
            regret_call[j][1] = (regret_call[j][1] + reach * (v_call - ev)).max(0.0);
        }

        // Linear averaging.
        let w = t as f64;
        for i in 0..n {
            sum_jam[i] += w * rm(&regret_jam[i]);
            sum_call[i] += w * rm(&regret_call[i]);
        }
        sum_w += w;
    }

    let jam: Vec<f64> = sum_jam.iter().map(|s| s / sum_w).collect();
    let call: Vec<f64> = sum_call.iter().map(|s| s / sum_w).collect();

    // Exact value + exploitability of the average strategy.
    let value = game_value(stack, blind_small, blind_big, equity, weights, &jam, &call);
    let br_sb = best_response_sb(stack, blind_small, blind_big, equity, weights, &call);
    let br_bb = best_response_bb(stack, blind_small, blind_big, equity, weights, &jam);
    JamFoldSolution { jam, call, value_sb: value, exploitability: (br_sb - value) + (br_bb + value) }
}

fn game_value(
    stack: f64,
    blind_small: f64,
    blind_big: f64,
    equity: &[Vec<f64>],
    weights: &[Vec<f64>],
    jam: &[f64],
    call: &[f64],
) -> f64 {
    let mut v = 0.0;
    for i in 0..169 {
        for j in 0..169 {
            let w = weights[i][j];
            if w <= 0.0 {
                continue;
            }
            let sd = 2.0 * stack * equity[i][j] - stack;
            let v_jam = (1.0 - call[j]) * blind_big + call[j] * sd;
            v += w * (jam[i] * v_jam + (1.0 - jam[i]) * -blind_small);
        }
    }
    v
}

/// SB best-response value against a fixed BB call strategy.
fn best_response_sb(
    stack: f64,
    blind_small: f64,
    blind_big: f64,
    equity: &[Vec<f64>],
    weights: &[Vec<f64>],
    call: &[f64],
) -> f64 {
    let mut v = 0.0;
    for i in 0..169 {
        let p_i: f64 = weights[i].iter().sum();
        if p_i <= 0.0 {
            continue;
        }
        let mut v_jam = 0.0;
        for j in 0..169 {
            let pj = weights[i][j] / p_i;
            let sd = 2.0 * stack * equity[i][j] - stack;
            v_jam += pj * ((1.0 - call[j]) * blind_big + call[j] * sd);
        }
        v += p_i * v_jam.max(-blind_small);
    }
    v
}

/// BB best-response value (from BB's perspective) against a fixed SB jam range.
fn best_response_bb(
    stack: f64,
    blind_small: f64,
    blind_big: f64,
    equity: &[Vec<f64>],
    weights: &[Vec<f64>],
    jam: &[f64],
) -> f64 {
    let mut v = 0.0;
    for j in 0..169 {
        // Folded pots: BB collects the small blind whenever SB folds.
        let mut fold_reach = 0.0;
        let mut jam_reach = 0.0;
        let mut v_call_num = 0.0;
        for i in 0..169 {
            fold_reach += weights[i][j] * (1.0 - jam[i]);
            let w = weights[i][j] * jam[i];
            jam_reach += w;
            v_call_num += w * (2.0 * stack * equity[j][i] - stack);
        }
        v += fold_reach * blind_small;
        if jam_reach > 0.0 {
            let v_call = v_call_num / jam_reach;
            v += jam_reach * v_call.max(-blind_big);
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::{parse_card, preflop_class, preflop_class_combos, preflop_class_name};
    use crate::equity::preflop_equity_table;

    #[test]
    fn jamfold_10bb_matches_published_nash() {
        let equity = preflop_equity_table(2_000, 99);
        let weights = class_pair_weights();
        let sol = solve(100.0, 5.0, 10.0, &equity, &weights, 20_000);

        assert!(
            sol.exploitability >= -1e-9 && sol.exploitability < 1.0,
            "exploitability should be non-negative and well under 1 chip/hand, got {}",
            sol.exploitability
        );

        let idx = |a: &str, b: &str| preflop_class(parse_card(a).unwrap(), parse_card(b).unwrap()) as usize;
        // Premiums always jam and always call at 10bb.
        for (a, b) in [("Ah", "As"), ("Kh", "Ks"), ("Ah", "Kh")] {
            let c = idx(a, b);
            assert!(sol.jam[c] > 0.95, "{} should always jam: {}", preflop_class_name(c as u8), sol.jam[c]);
            assert!(sol.call[c] > 0.95, "{} should always call: {}", preflop_class_name(c as u8), sol.call[c]);
        }
        // Trash folds: 32o neither jams much nor calls at 10bb.
        let c32o = idx("3h", "2c");
        assert!(sol.call[c32o] < 0.05, "32o should fold to a jam: {}", sol.call[c32o]);

        // Aggregate frequencies vs published Nash (10bb: SB jams ~55-60%,
        // BB calls ~35-45%). Loose gates: catches sign/scale errors, tolerates
        // Monte Carlo equity noise.
        let combo_w = |c: usize| preflop_class_combos(c as u8) as f64;
        let total: f64 = (0..169).map(combo_w).sum();
        let jam_pct: f64 = (0..169).map(|c| combo_w(c) * sol.jam[c]).sum::<f64>() / total;
        let call_pct: f64 = (0..169).map(|c| combo_w(c) * sol.call[c]).sum::<f64>() / total;
        assert!((0.40..=0.75).contains(&jam_pct), "10bb SB jam% ≈ 0.55-0.60, got {jam_pct}");
        assert!((0.25..=0.55).contains(&call_pct), "10bb BB call% ≈ 0.35-0.45, got {call_pct}");
    }
}

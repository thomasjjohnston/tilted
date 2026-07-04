//! M1 validation: CFR+ must converge to known equilibria on toy games.

use solver_kernel::br::{best_response_value, exploitability};
use solver_kernel::cfr::CfrPlusTrainer;
use solver_kernel::kuhn::Kuhn;
use solver_kernel::leduc::Leduc;

#[test]
fn kuhn_converges_to_known_value() {
    let g = Kuhn;
    let mut t = CfrPlusTrainer::new(&g);
    t.run(50_000);
    let value = t.game_value();
    let expl = exploitability(&g, &t.nodes);
    assert!(
        (value - (-1.0 / 18.0)).abs() < 1e-3,
        "kuhn value {value} should be ~ -1/18 ({})",
        -1.0 / 18.0
    );
    // Measured ~1.2e-3 at 50k iterations; RM+'s proven rate is O(1/sqrt(T)) and
    // tiny games track the theoretical rate rather than CFR+'s empirical 1/T.
    assert!(expl < 2e-3, "kuhn exploitability {expl} should be < 2e-3");
}

#[test]
fn kuhn_best_response_beats_uniform() {
    // Sanity check on the BR calculator itself: a best response against the
    // *initial* (uniform) strategy must gain a positive amount for either seat.
    let g = Kuhn;
    let t = CfrPlusTrainer::new(&g);
    let br0 = best_response_value(&g, &t.nodes, 0);
    let br1 = best_response_value(&g, &t.nodes, 1);
    assert!(br0 > 0.0, "BR as P0 vs uniform should be profitable, got {br0}");
    assert!(br1 > 0.0, "BR as P1 vs uniform should be profitable, got {br1}");
}

#[test]
fn leduc_converges_to_published_value() {
    let g = Leduc;
    let mut t = CfrPlusTrainer::new(&g);
    t.run(50_000);
    let value = t.game_value();
    let expl = exploitability(&g, &t.nodes);
    assert!(
        (value - (-0.0856)).abs() < 2e-3,
        "leduc value {value} should be ≈ -0.0856"
    );
    // Measured ~1.2e-2 at 50k iterations (units: chips, ante = 1).
    assert!(expl < 2e-2, "leduc exploitability {expl} should be < 2e-2");
}

#[test]
fn br_reports_zero_exploitability_for_known_kuhn_equilibrium() {
    // Hand-constructed exact Kuhn equilibrium (alpha = 1/3 family).
    // Cards: 0=J, 1=Q, 2=K. Actions: no bet [check, bet]; facing bet [fold, call].
    use solver_kernel::cfr::Node;
    use std::collections::HashMap;
    let mut nodes: HashMap<String, Node> = HashMap::new();
    let mut set = |key: &str, probs: &[f64]| {
        nodes.insert(
            key.to_string(),
            Node { regret: vec![0.0; probs.len()], strat_sum: probs.to_vec() },
        );
    };
    // P0 opening
    set("0:", &[2.0 / 3.0, 1.0 / 3.0]); // J: bet 1/3
    set("1:", &[1.0, 0.0]);             // Q: always check
    set("2:", &[0.0, 1.0]);             // K: always bet
    // P0 after check-bet
    set("0:cb", &[1.0, 0.0]);           // J: fold
    set("1:cb", &[1.0 / 3.0, 2.0 / 3.0]); // Q: call 2/3
    set("2:cb", &[0.0, 1.0]);           // K: call
    // P1 facing a check
    set("0:c", &[2.0 / 3.0, 1.0 / 3.0]); // J: bluff 1/3
    set("1:c", &[1.0, 0.0]);             // Q: check
    set("2:c", &[0.0, 1.0]);             // K: bet
    // P1 facing a bet
    set("0:b", &[1.0, 0.0]);             // J: fold
    set("1:b", &[2.0 / 3.0, 1.0 / 3.0]); // Q: call 1/3
    set("2:b", &[0.0, 1.0]);             // K: call

    let g = Kuhn;
    let expl = exploitability(&g, &nodes);
    assert!(expl.abs() < 1e-9, "exact equilibrium should have ~0 exploitability, got {expl}");
}

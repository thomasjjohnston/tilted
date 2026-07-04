//! Vanilla CFR+ for enumerable games (full tree traversal, alternating updates,
//! regret-matching+ with linear strategy averaging).

use crate::game::Game;
use std::collections::HashMap;

#[derive(Clone, Debug, Default)]
pub struct Node {
    pub regret: Vec<f64>,
    pub strat_sum: Vec<f64>,
}

impl Node {
    fn new(n: usize) -> Self {
        Node { regret: vec![0.0; n], strat_sum: vec![0.0; n] }
    }

    /// Current strategy from regret-matching+ (regrets are kept non-negative).
    pub fn strategy(&self) -> Vec<f64> {
        let total: f64 = self.regret.iter().sum();
        if total > 1e-12 {
            self.regret.iter().map(|r| r / total).collect()
        } else {
            vec![1.0 / self.regret.len() as f64; self.regret.len()]
        }
    }

    /// Normalized average strategy over all iterations.
    pub fn average_strategy(&self) -> Vec<f64> {
        let total: f64 = self.strat_sum.iter().sum();
        if total > 1e-12 {
            self.strat_sum.iter().map(|s| s / total).collect()
        } else {
            vec![1.0 / self.strat_sum.len() as f64; self.strat_sum.len()]
        }
    }
}

pub struct CfrPlusTrainer<'a, G: Game> {
    pub game: &'a G,
    pub nodes: HashMap<String, Node>,
    pub iterations: u64,
}

impl<'a, G: Game> CfrPlusTrainer<'a, G> {
    pub fn new(game: &'a G) -> Self {
        CfrPlusTrainer { game, nodes: HashMap::new(), iterations: 0 }
    }

    pub fn run(&mut self, iterations: u64) {
        for _ in 0..iterations {
            self.iterations += 1;
            let t = self.iterations;
            for player in 0..2 {
                let root = self.game.root();
                self.walk(&root, player, 1.0, 1.0, t);
            }
            // DCFR discounting (Brown & Sandholm 2019), alpha=1.5, gamma=2.
            // Positive regrets decay by t^1.5/(t^1.5+1), strategy sums by (t/(t+1))^2.
            // With RM+ clamping there are no negative regrets to discount.
            let tf = t as f64;
            let regret_disc = tf.powf(1.5) / (tf.powf(1.5) + 1.0);
            let strat_disc = (tf / (tf + 1.0)).powi(2);
            for node in self.nodes.values_mut() {
                for r in &mut node.regret {
                    *r *= regret_disc;
                }
                for s in &mut node.strat_sum {
                    *s *= strat_disc;
                }
            }
        }
    }

    /// Returns the counterfactual value of `state` for `player`.
    /// `reach_me` = product of player's own strategy probs on the path;
    /// `reach_other` = product of opponent + chance probs on the path.
    fn walk(&mut self, state: &G::State, player: usize, reach_me: f64, reach_other: f64, t: u64) -> f64 {
        let g = self.game;
        if g.is_terminal(state) {
            let u = g.utility(state);
            return if player == 0 { u } else { -u };
        }
        if g.is_chance(state) {
            let mut v = 0.0;
            for (child, p) in g.chance_outcomes(state) {
                v += p * self.walk(&child, player, reach_me, reach_other * p, t);
            }
            return v;
        }

        let acting = g.to_act(state);
        let key = g.infoset_key(state);
        let n_actions = g.num_actions(state);
        let strategy = self
            .nodes
            .entry(key.clone())
            .or_insert_with(|| Node::new(n_actions))
            .strategy();

        if acting == player {
            let mut action_values = vec![0.0; n_actions];
            let mut node_value = 0.0;
            for a in 0..n_actions {
                let child = g.next(state, a);
                action_values[a] = self.walk(&child, player, reach_me * strategy[a], reach_other, t);
                node_value += strategy[a] * action_values[a];
            }
            let node = self.nodes.get_mut(&key).unwrap();
            for a in 0..n_actions {
                // CFR+: accumulate counterfactual regret, clamped at zero.
                let r = node.regret[a] + reach_other * (action_values[a] - node_value);
                node.regret[a] = r.max(0.0);
            }
            // Average the *post-update* strategy. Iteration weighting comes from
            // the DCFR multiplicative discount applied in run(), so the increment
            // itself is unweighted (adding a t factor here would double-count).
            let new_strategy = node.strategy();
            for a in 0..n_actions {
                node.strat_sum[a] += reach_me * new_strategy[a];
            }
            node_value
        } else {
            let mut node_value = 0.0;
            for a in 0..n_actions {
                let child = g.next(state, a);
                node_value += strategy[a] * self.walk(&child, player, reach_me, reach_other * strategy[a], t);
            }
            node_value
        }
    }

    /// Expected game value for player 0 when both players follow the average strategy.
    pub fn game_value(&self) -> f64 {
        self.expected_value(&self.game.root())
    }

    fn expected_value(&self, state: &G::State) -> f64 {
        let g = self.game;
        if g.is_terminal(state) {
            return g.utility(state);
        }
        if g.is_chance(state) {
            return g
                .chance_outcomes(state)
                .iter()
                .map(|(c, p)| p * self.expected_value(c))
                .sum();
        }
        let key = g.infoset_key(state);
        let n = g.num_actions(state);
        let strat = self
            .nodes
            .get(&key)
            .map(|nd| nd.average_strategy())
            .unwrap_or_else(|| vec![1.0 / n as f64; n]);
        (0..n)
            .map(|a| strat[a] * self.expected_value(&g.next(state, a)))
            .sum()
    }
}

//! Exact best response and exploitability for enumerable games.
//!
//! Enumerates the full tree once, then resolves best-response infoset choices
//! from the deepest depth upward (valid under perfect recall: every BR infoset
//! reachable after another is strictly deeper in the tree).

use crate::cfr::Node;
use crate::game::Game;
use std::collections::HashMap;

struct TreeState<S> {
    state: S,
    depth: usize,
    /// chance reach × opponent (non-BR player) reach along the path.
    weight: f64,
    children: Vec<usize>,
    /// Infoset key if this is a BR-player decision node.
    br_key: Option<String>,
    value: f64,
}

/// Value of the best response by `br_player` against `nodes`' average strategy.
/// Returned from the BR player's own perspective.
pub fn best_response_value<G: Game>(game: &G, nodes: &HashMap<String, Node>, br_player: usize) -> f64 {
    // 1. Enumerate the full tree.
    let mut arena: Vec<TreeState<G::State>> = Vec::new();
    enumerate(game, nodes, br_player, game.root(), 0, 1.0, &mut arena);

    // 2. Group BR decision states by infoset.
    let mut infosets: HashMap<String, Vec<usize>> = HashMap::new();
    let mut max_depth = 0;
    for (i, ts) in arena.iter().enumerate() {
        if let Some(k) = &ts.br_key {
            infosets.entry(k.clone()).or_default().push(i);
        }
        max_depth = max_depth.max(ts.depth);
    }
    // Deepest representative depth per infoset (all members share a depth
    // under perfect recall, but be defensive and use the max).
    let mut infosets_by_depth: Vec<Vec<String>> = vec![Vec::new(); max_depth + 1];
    for (k, members) in &infosets {
        let d = members.iter().map(|&i| arena[i].depth).max().unwrap();
        infosets_by_depth[d].push(k.clone());
    }

    // 3. Resolve values bottom-up by depth.
    for depth in (0..=max_depth).rev() {
        // First: non-BR nodes at this depth (terminal values were set during
        // enumeration; chance and opponent nodes mix over children).
        for i in 0..arena.len() {
            if arena[i].depth == depth && arena[i].br_key.is_none() && !arena[i].children.is_empty() {
                arena[i].value = mixed_child_value(game, nodes, &arena, i);
            }
        }
        // Then: BR infosets at this depth pick one argmax action jointly.
        for key in &infosets_by_depth[depth] {
            let members = &infosets[key];
            let n_actions = arena[members[0]].children.len();
            let mut best_a = 0;
            let mut best_v = f64::NEG_INFINITY;
            for a in 0..n_actions {
                let v: f64 = members
                    .iter()
                    .map(|&i| {
                        let child = arena[i].children[a];
                        arena[i].weight * arena[child].value
                    })
                    .sum();
                if v > best_v {
                    best_v = v;
                    best_a = a;
                }
            }
            for &i in members {
                let child = arena[i].children[best_a];
                arena[i].value = arena[child].value;
            }
        }
    }
    arena[0].value
}

fn mixed_child_value<G: Game>(
    game: &G,
    nodes: &HashMap<String, Node>,
    arena: &[TreeState<G::State>],
    i: usize,
) -> f64 {
    let s = &arena[i].state;
    if game.is_chance(s) {
        let outcomes = game.chance_outcomes(s);
        return outcomes
            .iter()
            .zip(&arena[i].children)
            .map(|((_, p), &c)| p * arena[c].value)
            .sum();
    }
    // Opponent node: mix by their average strategy.
    let key = game.infoset_key(s);
    let n = game.num_actions(s);
    let strat = nodes
        .get(&key)
        .map(|nd| nd.average_strategy())
        .unwrap_or_else(|| vec![1.0 / n as f64; n]);
    arena[i]
        .children
        .iter()
        .enumerate()
        .map(|(a, &c)| strat[a] * arena[c].value)
        .sum()
}

fn enumerate<G: Game>(
    game: &G,
    nodes: &HashMap<String, Node>,
    br_player: usize,
    state: G::State,
    depth: usize,
    weight: f64,
    arena: &mut Vec<TreeState<G::State>>,
) -> usize {
    let idx = arena.len();
    let terminal = game.is_terminal(&state);
    let value = if terminal {
        let u = game.utility(&state);
        if br_player == 0 { u } else { -u }
    } else {
        0.0
    };
    let br_key = if !terminal && !game.is_chance(&state) && game.to_act(&state) == br_player {
        Some(game.infoset_key(&state))
    } else {
        None
    };
    arena.push(TreeState { state: state.clone(), depth, weight, children: Vec::new(), br_key, value });
    if terminal {
        return idx;
    }

    let children: Vec<usize> = if game.is_chance(&state) {
        game.chance_outcomes(&state)
            .into_iter()
            .map(|(child, p)| enumerate(game, nodes, br_player, child, depth + 1, weight * p, arena))
            .collect()
    } else if game.to_act(&state) == br_player {
        (0..game.num_actions(&state))
            .map(|a| enumerate(game, nodes, br_player, game.next(&state, a), depth + 1, weight, arena))
            .collect()
    } else {
        let key = game.infoset_key(&state);
        let n = game.num_actions(&state);
        let strat = nodes
            .get(&key)
            .map(|nd| nd.average_strategy())
            .unwrap_or_else(|| vec![1.0 / n as f64; n]);
        (0..n)
            .map(|a| {
                enumerate(game, nodes, br_player, game.next(&state, a), depth + 1, weight * strat[a], arena)
            })
            .collect()
    };
    arena[idx].children = children;
    idx
}

/// Exploitability: how much a best responder gains against the average strategy,
/// summed over both seats. Zero at an exact equilibrium.
pub fn exploitability<G: Game>(game: &G, nodes: &HashMap<String, Node>) -> f64 {
    best_response_value(game, nodes, 0) + best_response_value(game, nodes, 1)
}

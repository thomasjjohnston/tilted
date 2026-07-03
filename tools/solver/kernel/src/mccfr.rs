//! External-sampling MCCFR trainer for the abstract NLHE game.
//!
//! - Regret matching with non-negative (clamped) regrets.
//! - Traverser explores all actions; opponent and chance are sampled.
//! - Average strategy accumulated at opponent nodes (standard external sampling).
//! - Sharded hash-map store for multithreaded training.
//! - Checkpoint/resume via bincode; convergence tracked as the mean L1 movement
//!   of the average strategy on a fixed probe set between checkpoints.

use crate::cards::Card;
use crate::eval::eval7;
use crate::nlhe::{BetState, Buckets, NlheConfig};
use rand::Rng;
use rand::SeedableRng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const N_SHARDS: usize = 256;

/// Infoset key: (street << 12 | bucket, packed action sequence).
pub type Key = (u16, u128);

#[derive(Clone, Serialize, Deserialize)]
pub struct Node {
    pub regret: Vec<f32>,
    pub strat: Vec<f32>,
}

impl Node {
    fn new(n: usize) -> Self {
        Node { regret: vec![0.0; n], strat: vec![0.0; n] }
    }

    pub fn current(&self) -> Vec<f64> {
        let total: f64 = self.regret.iter().map(|&r| r as f64).sum();
        if total > 1e-9 {
            self.regret.iter().map(|&r| r as f64 / total).collect()
        } else {
            vec![1.0 / self.regret.len() as f64; self.regret.len()]
        }
    }

    pub fn average(&self) -> Vec<f64> {
        let total: f64 = self.strat.iter().map(|&s| s as f64).sum();
        if total > 1e-9 {
            self.strat.iter().map(|&s| s as f64 / total).collect()
        } else {
            vec![1.0 / self.strat.len() as f64; self.strat.len()]
        }
    }
}

pub struct Store {
    pub shards: Vec<Mutex<HashMap<Key, Node>>>,
}

impl Store {
    pub fn new() -> Self {
        Store { shards: (0..N_SHARDS).map(|_| Mutex::new(HashMap::new())).collect() }
    }

    fn shard_of(key: &Key) -> usize {
        // Cheap mix of both components.
        let h = key.0 as u128 ^ key.1 ^ (key.1 >> 67);
        (h as usize) % N_SHARDS
    }

    /// Read the current strategy (creating the node if absent).
    fn strategy(&self, key: Key, n_actions: usize) -> Vec<f64> {
        let mut shard = self.shards[Self::shard_of(&key)].lock().unwrap();
        shard.entry(key).or_insert_with(|| Node::new(n_actions)).current()
    }

    fn average(&self, key: Key, n_actions: usize) -> Vec<f64> {
        let shard = self.shards[Self::shard_of(&key)].lock().unwrap();
        shard
            .get(&key)
            .map(|n| n.average())
            .unwrap_or_else(|| vec![1.0 / n_actions as f64; n_actions])
    }

    fn update_regrets(&self, key: Key, deltas: &[f64]) {
        let mut shard = self.shards[Self::shard_of(&key)].lock().unwrap();
        if let Some(node) = shard.get_mut(&key) {
            for (r, &d) in node.regret.iter_mut().zip(deltas) {
                *r = (*r as f64 + d).max(0.0) as f32;
            }
        }
    }

    fn accumulate_strategy(&self, key: Key, sigma: &[f64]) {
        let mut shard = self.shards[Self::shard_of(&key)].lock().unwrap();
        if let Some(node) = shard.get_mut(&key) {
            for (s, &p) in node.strat.iter_mut().zip(sigma) {
                *s += p as f32;
            }
        }
    }

    pub fn len(&self) -> usize {
        self.shards.iter().map(|s| s.lock().unwrap().len()).sum()
    }
}

// ---------------------------------------------------------------------------
// A sampled deal with lazily computed buckets.
// ---------------------------------------------------------------------------

pub struct Deal {
    pub holes: [[Card; 2]; 2],
    pub board: [Card; 5],
}

impl Deal {
    pub fn sample<R: Rng>(rng: &mut R) -> Deal {
        let mut deck: Vec<Card> = (0..52).collect();
        // Partial shuffle: we need 9 cards.
        for i in 0..9 {
            let j = rng.gen_range(i..deck.len());
            deck.swap(i, j);
        }
        Deal {
            holes: [[deck[0], deck[1]], [deck[2], deck[3]]],
            board: [deck[4], deck[5], deck[6], deck[7], deck[8]],
        }
    }

    /// Compare hands at showdown: >0 if player 0 wins.
    pub fn showdown(&self) -> i32 {
        let mk = |p: usize| -> [Card; 7] {
            [
                self.holes[p][0],
                self.holes[p][1],
                self.board[0],
                self.board[1],
                self.board[2],
                self.board[3],
                self.board[4],
            ]
        };
        let (a, b) = (eval7(&mk(0)), eval7(&mk(1)));
        if a > b {
            1
        } else if a < b {
            -1
        } else {
            0
        }
    }
}

/// Per-deal bucket cache: buckets[street][player], computed lazily.
struct BucketCache<'a> {
    deal: &'a Deal,
    buckets: &'a Buckets,
    cache: [[Option<u16>; 2]; 4],
}

impl<'a> BucketCache<'a> {
    fn new(deal: &'a Deal, buckets: &'a Buckets) -> Self {
        BucketCache { deal, buckets, cache: [[None; 2]; 4] }
    }

    fn get(&mut self, street: usize, player: usize) -> u16 {
        if let Some(b) = self.cache[street][player] {
            return b;
        }
        let board = &self.deal.board[..board_len(street)];
        let b = self.buckets.assign(street, self.deal.holes[player], board);
        self.cache[street][player] = Some(b);
        b
    }
}

pub fn board_len(street: usize) -> usize {
    match street {
        0 => 0,
        1 => 3,
        2 => 4,
        _ => 5,
    }
}

fn infoset_key(state: &BetState, bucket: u16) -> Key {
    let sb = ((state.street as u16) << 12) | bucket;
    (sb, crate::nlhe::pack_seq(&state.seq))
}

// ---------------------------------------------------------------------------
// Trainer
// ---------------------------------------------------------------------------

pub struct Trainer {
    pub config: NlheConfig,
    pub depth_bb: u32,
    pub buckets: Buckets,
    pub store: Store,
    pub iterations: AtomicU64,
}

impl Trainer {
    pub fn new(config: NlheConfig, depth_bb: u32, buckets: Buckets) -> Self {
        Trainer { config, depth_bb, buckets, store: Store::new(), iterations: AtomicU64::new(0) }
    }

    /// One MCCFR iteration: sample a deal, traverse once for each player.
    pub fn iterate<R: Rng>(&self, rng: &mut R) {
        let deal = Deal::sample(rng);
        let mut cache = BucketCache::new(&deal, &self.buckets);
        for p in 0..2 {
            let state = BetState::new(&self.config, self.depth_bb);
            self.traverse(&state, p, &deal, &mut cache, rng);
        }
        self.iterations.fetch_add(1, Ordering::Relaxed);
    }

    /// External-sampling traversal. Returns the value for `traverser`.
    fn traverse<R: Rng>(
        &self,
        state: &BetState,
        traverser: usize,
        deal: &Deal,
        cache: &mut BucketCache,
        rng: &mut R,
    ) -> f64 {
        if state.terminal.is_some() {
            let u0 = state.utility_p0(|| deal.showdown());
            return if traverser == 0 { u0 } else { -u0 };
        }
        let actor = state.to_act;
        let actions = state.legal_actions(&self.config, self.depth_bb);
        let bucket = cache.get(state.street, actor);
        let key = infoset_key(state, bucket);
        let sigma = self.store.strategy(key, actions.len());

        if actor == traverser {
            let mut values = vec![0.0f64; actions.len()];
            let mut node_value = 0.0;
            for (i, &a) in actions.iter().enumerate() {
                let mut child = state.clone();
                child.apply(a);
                values[i] = self.traverse(&child, traverser, deal, cache, rng);
                node_value += sigma[i] * values[i];
            }
            let deltas: Vec<f64> = values.iter().map(|v| v - node_value).collect();
            self.store.update_regrets(key, &deltas);
            node_value
        } else {
            // Sample the opponent's action; accumulate their average strategy.
            self.store.accumulate_strategy(key, &sigma);
            let a = sample_index(&sigma, rng);
            let mut child = state.clone();
            child.apply(actions[a]);
            self.traverse(&child, traverser, deal, cache, rng)
        }
    }

    /// Multithreaded training until `iters` more iterations or `max_time` elapses.
    /// `progress` is called from the coordinating thread roughly every 2 seconds.
    pub fn train(
        &self,
        iters: u64,
        max_time: Option<Duration>,
        threads: usize,
        seed: u64,
        progress: impl Fn(u64, f64) + Sync,
    ) {
        let start_iters = self.iterations.load(Ordering::Relaxed);
        let target = start_iters + iters;
        let stop = AtomicBool::new(false);
        let t0 = Instant::now();

        std::thread::scope(|scope| {
            for tid in 0..threads {
                let stop = &stop;
                let trainer = &self;
                scope.spawn(move || {
                    let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(
                        seed ^ (tid as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ start_iters,
                    );
                    while !stop.load(Ordering::Relaxed) {
                        trainer.iterate(&mut rng);
                        if trainer.iterations.load(Ordering::Relaxed) >= target {
                            stop.store(true, Ordering::Relaxed);
                        }
                    }
                });
            }
            // Coordinator: progress + time budget.
            let mut last_report = Instant::now();
            let mut last_iters = start_iters;
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(200));
                if let Some(max) = max_time {
                    if t0.elapsed() >= max {
                        stop.store(true, Ordering::Relaxed);
                    }
                }
                if last_report.elapsed() >= Duration::from_secs(2) {
                    let now = self.iterations.load(Ordering::Relaxed);
                    let ips = (now - last_iters) as f64 / last_report.elapsed().as_secs_f64();
                    progress(now, ips);
                    last_report = Instant::now();
                    last_iters = now;
                }
            }
        });
    }
}

fn sample_index<R: Rng>(probs: &[f64], rng: &mut R) -> usize {
    let x: f64 = rng.gen();
    let mut acc = 0.0;
    for (i, &p) in probs.iter().enumerate() {
        acc += p;
        if x < acc {
            return i;
        }
    }
    probs.len() - 1
}

// ---------------------------------------------------------------------------
// Checkpointing
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct Checkpoint {
    pub config_json: String,
    pub depth_bb: u32,
    pub iterations: u64,
    pub entries: Vec<(Key, Node)>,
}

pub fn save_checkpoint(trainer: &Trainer, path: &Path) -> std::io::Result<()> {
    let entries: Vec<(Key, Node)> = trainer
        .store
        .shards
        .iter()
        .flat_map(|s| s.lock().unwrap().iter().map(|(k, v)| (*k, v.clone())).collect::<Vec<_>>())
        .collect();
    let cp = Checkpoint {
        config_json: serde_json::to_string(&trainer.config).unwrap(),
        depth_bb: trainer.depth_bb,
        iterations: trainer.iterations.load(Ordering::Relaxed),
        entries,
    };
    let tmp = path.with_extension("tmp");
    let file = std::fs::File::create(&tmp)?;
    bincode::serialize_into(std::io::BufWriter::new(file), &cp)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::rename(tmp, path)
}

pub fn load_checkpoint(trainer: &Trainer, path: &Path) -> std::io::Result<u64> {
    let file = std::fs::File::open(path)?;
    let cp: Checkpoint = bincode::deserialize_from(std::io::BufReader::new(file))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let expect = serde_json::to_string(&trainer.config).unwrap();
    if cp.config_json != expect || cp.depth_bb != trainer.depth_bb {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "checkpoint config mismatch: retrain or use the original config",
        ));
    }
    for (k, v) in cp.entries {
        let mut shard = trainer.store.shards[Store::shard_of(&k)].lock().unwrap();
        shard.insert(k, v);
    }
    trainer.iterations.store(cp.iterations, Ordering::Relaxed);
    Ok(cp.iterations)
}

// ---------------------------------------------------------------------------
// Convergence probe: mean L1 movement of the average strategy on a fixed,
// deterministic subset of infosets between two snapshots.
// ---------------------------------------------------------------------------

pub type Probe = Vec<(Key, Vec<f32>)>;

pub fn probe_snapshot(trainer: &Trainer, max_nodes: usize) -> Probe {
    let per_shard = (max_nodes / N_SHARDS).max(1);
    let mut probe = Vec::new();
    for shard in &trainer.store.shards {
        let shard = shard.lock().unwrap();
        // Deterministic subset: smallest keys in each shard.
        let mut keys: Vec<&Key> = shard.keys().collect();
        keys.sort();
        for k in keys.into_iter().take(per_shard) {
            let avg: Vec<f32> = shard[k].average().iter().map(|&x| x as f32).collect();
            probe.push((*k, avg));
        }
    }
    probe
}

/// Mean L1 distance / 2 between snapshots (range 0..1); ~0 when converged.
pub fn probe_delta(prev: &Probe, cur: &Probe) -> f64 {
    let prev_map: HashMap<&Key, &Vec<f32>> = prev.iter().map(|(k, v)| (k, v)).collect();
    let mut total = 0.0;
    let mut n = 0usize;
    for (k, v) in cur {
        if let Some(pv) = prev_map.get(&k) {
            if pv.len() == v.len() {
                let l1: f64 = v.iter().zip(pv.iter()).map(|(a, b)| (a - b).abs() as f64).sum();
                total += l1 / 2.0;
                n += 1;
            }
        }
    }
    if n == 0 {
        1.0
    } else {
        total / n as f64
    }
}

// ---------------------------------------------------------------------------
// EV extraction: sampled Q-values under the average strategy profile.
// ---------------------------------------------------------------------------

pub struct EvAccum {
    pub map: Mutex<HashMap<Key, (Vec<f64>, Vec<u32>)>>,
}

/// Run `iters` sampled evaluation deals. Both players follow the average
/// strategy; at every visited decision node, each action's value is estimated
/// (the on-path action by recursion, off-path actions by a single rollout) and
/// accumulated per infoset.
pub fn extract_evs(trainer: &Trainer, iters: u64, seed: u64, threads: usize) -> HashMap<Key, (Vec<f64>, Vec<u32>)> {
    let accum = EvAccum { map: Mutex::new(HashMap::new()) };
    let done = AtomicU64::new(0);
    std::thread::scope(|scope| {
        for tid in 0..threads {
            let accum = &accum;
            let done = &done;
            let trainer_ref = &trainer;
            scope.spawn(move || {
                let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(seed ^ (tid as u64) << 32);
                loop {
                    if done.fetch_add(1, Ordering::Relaxed) >= iters {
                        break;
                    }
                    let deal = Deal::sample(&mut rng);
                    let mut cache = BucketCache::new(&deal, &trainer_ref.buckets);
                    let state = BetState::new(&trainer_ref.config, trainer_ref.depth_bb);
                    ev_walk(trainer_ref, &state, &deal, &mut cache, &mut rng, accum);
                }
            });
        }
    });
    accum.map.into_inner().unwrap()
}

/// Returns the value (for the acting player at this node... returned value is
/// for player 0 to keep signs simple; per-action accumulation converts sign).
fn ev_walk<R: Rng>(
    trainer: &Trainer,
    state: &BetState,
    deal: &Deal,
    cache: &mut BucketCache,
    rng: &mut R,
    accum: &EvAccum,
) -> f64 {
    if state.terminal.is_some() {
        return state.utility_p0(|| deal.showdown());
    }
    let actor = state.to_act;
    let actions = state.legal_actions(&trainer.config, trainer.depth_bb);
    let bucket = cache.get(state.street, actor);
    let key = infoset_key(state, bucket);
    let sigma = trainer.store.average(key, actions.len());
    let chosen = sample_index(&sigma, rng);

    let mut q = vec![0.0f64; actions.len()];
    for (i, &a) in actions.iter().enumerate() {
        let mut child = state.clone();
        child.apply(a);
        if i == chosen {
            q[i] = ev_walk(trainer, &child, deal, cache, rng, accum);
        } else {
            q[i] = rollout(trainer, &child, deal, cache, rng);
        }
    }

    {
        let mut map = accum.map.lock().unwrap();
        let entry = map.entry(key).or_insert_with(|| (vec![0.0; actions.len()], vec![0; actions.len()]));
        for i in 0..actions.len() {
            // Store from the acting player's perspective.
            let v = if actor == 0 { q[i] } else { -q[i] };
            entry.0[i] += v;
            entry.1[i] += 1;
        }
    }
    q[chosen]
}

fn rollout<R: Rng>(
    trainer: &Trainer,
    state: &BetState,
    deal: &Deal,
    cache: &mut BucketCache,
    rng: &mut R,
) -> f64 {
    let mut s = state.clone();
    while s.terminal.is_none() {
        let actions = s.legal_actions(&trainer.config, trainer.depth_bb);
        let bucket = cache.get(s.street, s.to_act);
        let key = infoset_key(&s, bucket);
        let sigma = trainer.store.average(key, actions.len());
        let a = sample_index(&sigma, rng);
        s.apply(actions[a]);
    }
    s.utility_p0(|| deal.showdown())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trainer_smoke_10bb() {
        // Tiny run at 10bb with tiny buckets: verifies the full loop end to end.
        let config = NlheConfig::default();
        let bconf = crate::nlhe::BucketConfig {
            flop: 20,
            turn: 20,
            river: 20,
            ehs_samples: 32,
            boundary_samples: 500,
        };
        let buckets = crate::nlhe::build_buckets(&bconf, 3);
        let trainer = Trainer::new(config, 10, buckets);
        trainer.train(2_000, None, 2, 7, |_, _| {});
        assert!(trainer.iterations.load(Ordering::Relaxed) >= 2_000);
        assert!(trainer.store.len() > 100, "should have discovered many infosets");

        // The SB's root strategy over AA should strongly prefer aggression
        // (raise or jam) over folding even in a barely-trained model.
        let aa_class = crate::cards::preflop_class(48, 49); // two aces
        let root = BetState::new(&trainer.config, 10);
        let key = infoset_key(&root, aa_class as u16);
        let actions = root.legal_actions(&trainer.config, 10);
        let avg = trainer.store.average(key, actions.len());
        let fold_idx = actions.iter().position(|a| a.token == crate::nlhe::TOK_FOLD).unwrap();
        assert!(avg[fold_idx] < 0.35, "AA should rarely fold at the root, got {avg:?}");
    }

    #[test]
    fn checkpoint_roundtrip() {
        let config = NlheConfig::default();
        let bconf = crate::nlhe::BucketConfig {
            flop: 10,
            turn: 10,
            river: 10,
            ehs_samples: 16,
            boundary_samples: 200,
        };
        let buckets = crate::nlhe::build_buckets(&bconf, 5);
        let trainer = Trainer::new(config.clone(), 10, buckets.clone());
        trainer.train(500, None, 2, 11, |_, _| {});
        let n1 = trainer.store.len();
        let iters1 = trainer.iterations.load(Ordering::Relaxed);

        let dir = std::env::temp_dir().join("solver-kernel-test-ckpt");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ckpt.bin");
        save_checkpoint(&trainer, &path).unwrap();

        let restored = Trainer::new(config, 10, buckets);
        let iters2 = load_checkpoint(&restored, &path).unwrap();
        assert_eq!(iters1, iters2);
        assert_eq!(restored.store.len(), n1);
        std::fs::remove_file(path).ok();
    }
}

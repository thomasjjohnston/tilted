//! SQLite artifact export: the contract between the Rust trainer and every
//! downstream consumer (Python advisor, Solver Lab, future TS runtime port).
//!
//! Schema (version 1):
//!   meta(key TEXT PRIMARY KEY, value TEXT)
//!     keys: schema_version, config (NlheConfig JSON), buckets (Buckets JSON),
//!           depths (JSON array of depth_bb present)
//!   strategies(depth_bb, street, seq, bucket, tokens, tos, strategy, ev, ev_n, visits)
//!     seq is the human-readable token string (e.g. "r0c/cr1c/"), tokens/tos
//!     the legal actions at that node, strategy the normalized average strategy.

use crate::mccfr::{extract_evs, Trainer};
use crate::nlhe::{seq_to_string, BetState, Buckets, LegalAction, NlheConfig};
use rusqlite::{params, Connection};

pub const SCHEMA_VERSION: i64 = 1;

fn unpack_seq(packed: u128) -> Vec<u8> {
    let len = (packed >> 122) as usize;
    (0..len).map(|i| ((packed >> (i * 4)) & 0xF) as u8).collect()
}

/// Replay a token sequence from the root; returns the state (None if the
/// sequence is inconsistent with the current config, e.g. after a config edit).
pub fn replay_seq(config: &NlheConfig, depth_bb: u32, seq: &[u8]) -> Option<(BetState, Vec<LegalAction>)> {
    let mut state = BetState::new(config, depth_bb);
    let mut i = 0;
    while i < seq.len() {
        let tok = seq[i];
        if tok == crate::nlhe::TOK_STREET {
            // Street separators are appended by apply(); they should already
            // have been consumed. Seeing one here means desync.
            return None;
        }
        if state.terminal.is_some() {
            return None;
        }
        let actions = state.legal_actions(config, depth_bb);
        let action = *actions.iter().find(|a| a.token == tok)?;
        state.apply(action);
        i += 1;
        // apply() may have pushed a street separator; skip it in the input too.
        if state.seq.len() > i && state.seq[i] == crate::nlhe::TOK_STREET {
            if seq.get(i) != Some(&crate::nlhe::TOK_STREET) {
                return None;
            }
            i += 1;
        }
    }
    if state.terminal.is_some() {
        return None;
    }
    let actions = state.legal_actions(config, depth_bb);
    Some((state, actions))
}

pub fn create_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS strategies (
            depth_bb INTEGER NOT NULL,
            street   INTEGER NOT NULL,
            seq      TEXT    NOT NULL,
            bucket   INTEGER NOT NULL,
            tokens   TEXT    NOT NULL,
            tos      TEXT    NOT NULL,
            strategy TEXT    NOT NULL,
            ev       TEXT,
            ev_n     TEXT,
            visits   REAL    NOT NULL,
            PRIMARY KEY (depth_bb, street, seq, bucket)
         );",
    )
}

/// Export one trained depth into the artifact (upserting).
pub fn export_depth(
    conn: &mut Connection,
    trainer: &Trainer,
    ev_iters: u64,
    threads: usize,
    seed: u64,
) -> rusqlite::Result<usize> {
    let evs = if ev_iters > 0 {
        extract_evs(trainer, ev_iters, seed, threads)
    } else {
        Default::default()
    };

    let tx = conn.transaction()?;
    let mut written = 0usize;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO strategies
             (depth_bb, street, seq, bucket, tokens, tos, strategy, ev, ev_n, visits)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )?;
        for shard in &trainer.store.shards {
            let shard = shard.lock().unwrap();
            for (key, node) in shard.iter() {
                let (sb, packed) = *key;
                let street = (sb >> 12) as usize;
                let bucket = sb & 0xFFF;
                let seq_tokens = unpack_seq(packed);
                let Some((state, actions)) = replay_seq(&trainer.config, trainer.depth_bb, &seq_tokens)
                else {
                    continue;
                };
                debug_assert_eq!(state.street, street);
                if actions.len() != node.strat.len() {
                    continue; // config drift; skip defensively
                }
                let avg = node.average();
                // Skip never-reached nodes: they carry no information.
                let visits: f64 = node.strat.iter().map(|&s| s as f64).sum();
                if visits <= 0.0 {
                    continue;
                }
                let token_names: Vec<String> =
                    actions.iter().map(|a| crate::nlhe::token_name(a.token)).collect();
                let tos: Vec<u32> = actions.iter().map(|a| a.to).collect();
                let (ev_json, evn_json) = match evs.get(key) {
                    Some((sums, counts)) if counts.len() == actions.len() => {
                        let means: Vec<f64> = sums
                            .iter()
                            .zip(counts)
                            .map(|(s, &n)| if n > 0 { s / n as f64 } else { f64::NAN })
                            .collect();
                        (
                            Some(serde_json::to_string(&means).unwrap()),
                            Some(serde_json::to_string(&counts).unwrap()),
                        )
                    }
                    _ => (None, None),
                };
                stmt.execute(params![
                    trainer.depth_bb,
                    street as i64,
                    seq_to_string(&seq_tokens),
                    bucket as i64,
                    serde_json::to_string(&token_names).unwrap(),
                    serde_json::to_string(&tos).unwrap(),
                    serde_json::to_string(&avg).unwrap(),
                    ev_json,
                    evn_json,
                    visits,
                ])?;
                written += 1;
            }
        }
    }
    tx.commit()?;
    Ok(written)
}

pub fn write_meta(conn: &Connection, config: &NlheConfig, buckets: &Buckets, depths: &[u32]) -> rusqlite::Result<()> {
    let set = |k: &str, v: String| -> rusqlite::Result<()> {
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)", params![k, v])?;
        Ok(())
    };
    set("schema_version", SCHEMA_VERSION.to_string())?;
    set("config", serde_json::to_string_pretty(config).unwrap())?;
    set("buckets", serde_json::to_string(buckets).unwrap())?;
    set("depths", serde_json::to_string(depths).unwrap())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nlhe::pack_seq;

    #[test]
    fn pack_unpack_roundtrip() {
        let seqs: Vec<Vec<u8>> = vec![
            vec![],
            vec![1],
            vec![2, 1, 15, 1, 1, 15],
            vec![2, 3, 14, 1],
            (0..30).map(|i| (i % 14) as u8).collect(),
        ];
        for seq in seqs {
            assert_eq!(unpack_seq(pack_seq(&seq)), seq);
        }
    }

    #[test]
    fn replay_open_call_reaches_flop() {
        let config = NlheConfig::default();
        // r0 (open 2.5bb), call, street separator -> flop root.
        let seq = vec![2u8, 1, 15];
        let (state, actions) = replay_seq(&config, 100, &seq).expect("valid seq");
        assert_eq!(state.street, 1);
        assert!(!actions.is_empty());
    }

    #[test]
    fn replay_rejects_garbage() {
        let config = NlheConfig::default();
        assert!(replay_seq(&config, 100, &[9, 9, 9]).is_none());
    }
}

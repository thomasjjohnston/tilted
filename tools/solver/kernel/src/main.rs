use clap::{Parser, Subcommand};
use solver_kernel::br::exploitability;
use solver_kernel::cards::{parse_cards, preflop_class_name};
use solver_kernel::cfr::CfrPlusTrainer;
use solver_kernel::jamfold::class_pair_weights;
use solver_kernel::kuhn::Kuhn;
use solver_kernel::leduc::Leduc;
use solver_kernel::mccfr::{
    load_checkpoint, probe_delta, probe_snapshot, save_checkpoint, Probe, Trainer,
};
use solver_kernel::nlhe::{build_buckets, Buckets, NlheConfig};
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Parser)]
#[command(name = "solver-kernel", about = "Tilted offline solver kernel")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Validate the CFR+ core on toy games with exact exploitability.
    Toy {
        #[arg(long, default_value = "kuhn")]
        game: String,
        #[arg(long, default_value_t = 10_000)]
        iters: u64,
    },
    /// Solve the exact preflop jam/fold game at a given stack depth.
    Jamfold {
        #[arg(long, default_value_t = 10)]
        depth_bb: u32,
        #[arg(long, default_value_t = 5_000)]
        equity_samples: u32,
        #[arg(long, default_value_t = 50_000)]
        iters: u64,
        /// Write full ranges as JSON to this path.
        #[arg(long)]
        json: Option<PathBuf>,
    },
    /// Build E[HS] percentile bucket boundaries (once per run; depth-independent).
    Buckets {
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value_t = 17)]
        seed: u64,
    },
    /// Train one depth with MCCFR. Auto-resumes from the checkpoint in --dir.
    Train {
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long)]
        buckets: PathBuf,
        #[arg(long)]
        depth_bb: u32,
        /// Run directory; checkpoint lives at <dir>/depth-<D>/checkpoint.bin
        #[arg(long)]
        dir: PathBuf,
        #[arg(long)]
        iters: Option<u64>,
        #[arg(long)]
        minutes: Option<f64>,
        #[arg(long, default_value_t = 4)]
        threads: usize,
        #[arg(long, default_value_t = 1)]
        seed: u64,
    },
    /// Export trained depths from a run directory into a SQLite artifact.
    Export {
        #[arg(long)]
        dir: PathBuf,
        #[arg(long)]
        out: PathBuf,
        /// Sampled deals for per-action EV estimation (0 = skip EVs).
        #[arg(long, default_value_t = 200_000)]
        ev_iters: u64,
        #[arg(long, default_value_t = 4)]
        threads: usize,
        #[arg(long, default_value_t = 23)]
        seed: u64,
    },
    /// Assign a bucket to a concrete hand (single query or --batch JSONL on stdin).
    BucketAssign {
        #[arg(long)]
        buckets: PathBuf,
        #[arg(long)]
        street: Option<String>,
        #[arg(long)]
        hole: Option<String>,
        #[arg(long)]
        board: Option<String>,
        #[arg(long, default_value_t = false)]
        batch: bool,
    },
    /// Measure training throughput on this machine.
    Bench {
        #[arg(long, default_value_t = 10.0)]
        seconds: f64,
        #[arg(long, default_value_t = 4)]
        threads: usize,
        #[arg(long, default_value_t = 100)]
        depth_bb: u32,
    },
}

fn load_config(path: &Option<PathBuf>) -> NlheConfig {
    match path {
        Some(p) => {
            let s = std::fs::read_to_string(p).expect("read config");
            serde_json::from_str(&s).expect("parse config")
        }
        None => NlheConfig::default(),
    }
}

fn load_buckets(path: &Path) -> Buckets {
    let s = std::fs::read_to_string(path).expect("read buckets file");
    serde_json::from_str(&s).expect("parse buckets file")
}

fn street_index(name: &str) -> usize {
    match name {
        "preflop" => 0,
        "flop" => 1,
        "turn" => 2,
        "river" => 3,
        _ => panic!("bad street: {name}"),
    }
}

fn jsonl(v: serde_json::Value) {
    println!("{v}");
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Command::Toy { game, iters } => match game.as_str() {
            "kuhn" => {
                let g = Kuhn;
                let mut t = CfrPlusTrainer::new(&g);
                t.run(iters);
                let value = t.game_value();
                let expl = exploitability(&g, &t.nodes);
                println!("kuhn: iters={iters} value={value:.6} (exact -1/18 = {:.6}) exploitability={expl:.6}", -1.0 / 18.0);
            }
            "leduc" => {
                let g = Leduc;
                let mut t = CfrPlusTrainer::new(&g);
                t.run(iters);
                let value = t.game_value();
                let expl = exploitability(&g, &t.nodes);
                println!("leduc: iters={iters} value={value:.6} (published ≈ -0.0856) exploitability={expl:.6}");
            }
            other => {
                eprintln!("unknown game: {other}");
                std::process::exit(1);
            }
        },

        Command::Jamfold { depth_bb, equity_samples, iters, json } => {
            eprintln!("computing 169x169 preflop equity table ({equity_samples} samples/pair)...");
            let equity = solver_kernel::equity::preflop_equity_table(equity_samples, 99);
            let weights = class_pair_weights();
            let sol = solver_kernel::jamfold::solve(
                (depth_bb * 10) as f64,
                5.0,
                10.0,
                &equity,
                &weights,
                iters as u32,
            );
            let combo_w = |c: u8| solver_kernel::cards::preflop_class_combos(c) as f64;
            let total_w: f64 = (0..169u8).map(combo_w).sum();
            let jam_pct: f64 =
                (0..169u8).map(|c| combo_w(c) * sol.jam[c as usize]).sum::<f64>() / total_w;
            let call_pct: f64 =
                (0..169u8).map(|c| combo_w(c) * sol.call[c as usize]).sum::<f64>() / total_w;
            println!(
                "jamfold depth={depth_bb}bb value_sb={:.3} exploitability={:.4} jam%={:.1} call%={:.1}",
                sol.value_sb,
                sol.exploitability,
                jam_pct * 100.0,
                call_pct * 100.0
            );
            if let Some(path) = json {
                let out = serde_json::json!({
                    "depth_bb": depth_bb,
                    "value_sb": sol.value_sb,
                    "exploitability": sol.exploitability,
                    "jam": (0..169u8).map(|c| serde_json::json!({
                        "class": preflop_class_name(c), "p": sol.jam[c as usize]
                    })).collect::<Vec<_>>(),
                    "call": (0..169u8).map(|c| serde_json::json!({
                        "class": preflop_class_name(c), "p": sol.call[c as usize]
                    })).collect::<Vec<_>>(),
                });
                std::fs::write(path, serde_json::to_string_pretty(&out).unwrap()).expect("write json");
            }
        }

        Command::Buckets { config, out, seed } => {
            let cfg = load_config(&config);
            eprintln!(
                "building buckets: flop={} turn={} river={} ({} samples/street, {} EHS samples)...",
                cfg.buckets.flop, cfg.buckets.turn, cfg.buckets.river,
                cfg.buckets.boundary_samples, cfg.buckets.ehs_samples
            );
            let buckets = build_buckets(&cfg.buckets, seed);
            std::fs::write(&out, serde_json::to_string(&buckets).unwrap()).expect("write buckets");
            jsonl(serde_json::json!({"t": "buckets_done", "path": out}));
        }

        Command::Train { config, buckets, depth_bb, dir, iters, minutes, threads, seed } => {
            let cfg = load_config(&config);
            let bks = load_buckets(&buckets);
            let depth_dir = dir.join(format!("depth-{depth_bb}"));
            std::fs::create_dir_all(&depth_dir).expect("create depth dir");
            let ckpt_path = depth_dir.join("checkpoint.bin");
            let probe_path = depth_dir.join("probe.bin");

            let trainer = Trainer::new(cfg, depth_bb, bks);
            let resumed = if ckpt_path.exists() {
                load_checkpoint(&trainer, &ckpt_path).expect("load checkpoint")
            } else {
                0
            };
            jsonl(serde_json::json!({
                "t": "start", "depth_bb": depth_bb, "resumed_iters": resumed,
                "threads": threads,
            }));

            let max_time = minutes.map(|m| Duration::from_secs_f64(m * 60.0));
            let chunk_iters = iters.unwrap_or(u64::MAX / 2);
            let t0 = std::time::Instant::now();
            trainer.train(chunk_iters, max_time, threads, seed, |it, ips| {
                jsonl(serde_json::json!({
                    "t": "progress", "depth_bb": depth_bb, "iters": it,
                    "ips": ips.round(), "elapsed_sec": t0.elapsed().as_secs(),
                }));
            });

            // Convergence probe: compare against the previous snapshot.
            let cur_probe = probe_snapshot(&trainer, 20_000);
            let delta = if probe_path.exists() {
                let bytes = std::fs::read(&probe_path).expect("read probe");
                let prev: Probe = bincode::deserialize(&bytes).expect("parse probe");
                Some(probe_delta(&prev, &cur_probe))
            } else {
                None
            };
            std::fs::write(&probe_path, bincode::serialize(&cur_probe).unwrap()).expect("write probe");
            save_checkpoint(&trainer, &ckpt_path).expect("save checkpoint");

            let final_iters = trainer.iterations.load(std::sync::atomic::Ordering::Relaxed);
            let infosets = trainer.store.len();
            // Append to the depth's history file (the runner reads this).
            let hist_path = depth_dir.join("history.jsonl");
            let record = serde_json::json!({
                "t": "checkpoint", "depth_bb": depth_bb, "iters": final_iters,
                "chunk_iters": final_iters - resumed,
                "elapsed_sec": t0.elapsed().as_secs_f64().round(),
                "infosets": infosets,
                "probe_delta": delta,
            });
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&hist_path).unwrap();
            writeln!(f, "{record}").unwrap();
            jsonl(record);
        }

        Command::Export { dir, out, ev_iters, threads, seed } => {
            // Discover trained depths.
            let mut depths: Vec<u32> = Vec::new();
            for entry in std::fs::read_dir(&dir).expect("read run dir") {
                let entry = entry.expect("dir entry");
                let name = entry.file_name().into_string().unwrap_or_default();
                if let Some(d) = name.strip_prefix("depth-") {
                    if entry.path().join("checkpoint.bin").exists() {
                        if let Ok(d) = d.parse::<u32>() {
                            depths.push(d);
                        }
                    }
                }
            }
            depths.sort();
            assert!(!depths.is_empty(), "no trained depths found in {dir:?}");

            let mut conn = rusqlite::Connection::open(&out).expect("open artifact");
            solver_kernel::artifact::create_schema(&conn).expect("create schema");

            let mut config: Option<NlheConfig> = None;
            let mut buckets: Option<Buckets> = None;
            for &d in &depths {
                let ckpt = dir.join(format!("depth-{d}")).join("checkpoint.bin");
                // Peek config from the checkpoint itself for consistency.
                let bytes = std::fs::read(&ckpt).expect("read checkpoint");
                let cp: solver_kernel::mccfr::Checkpoint =
                    bincode::deserialize(&bytes).expect("parse checkpoint");
                let cfg: NlheConfig = serde_json::from_str(&cp.config_json).expect("config in checkpoint");
                let bks = load_buckets(&dir.join("buckets.json"));
                let trainer = Trainer::new(cfg.clone(), d, bks.clone());
                load_checkpoint(&trainer, &ckpt).expect("load checkpoint");
                let written = solver_kernel::artifact::export_depth(&mut conn, &trainer, ev_iters, threads, seed)
                    .expect("export depth");
                jsonl(serde_json::json!({
                    "t": "export_depth", "depth_bb": d, "infosets_written": written,
                }));
                config = Some(cfg);
                buckets = Some(bks);
            }
            solver_kernel::artifact::write_meta(&conn, &config.unwrap(), &buckets.unwrap(), &depths)
                .expect("write meta");
            jsonl(serde_json::json!({"t": "export_done", "path": out, "depths": depths}));
        }

        Command::BucketAssign { buckets, street, hole, board, batch } => {
            let bks = load_buckets(&buckets);
            let assign = |street: &str, hole_s: &str, board_s: &str| -> serde_json::Value {
                let street = street_index(street);
                let hole_cards = parse_cards(hole_s).expect("parse hole");
                assert_eq!(hole_cards.len(), 2, "hole must be 2 cards");
                let board_cards = parse_cards(board_s).expect("parse board");
                let hole: [u8; 2] = [hole_cards[0], hole_cards[1]];
                let bucket = bks.assign(street, hole, &board_cards);
                let ehs = if street == 0 {
                    f64::NAN
                } else {
                    solver_kernel::nlhe::deterministic_ehs(hole, &board_cards, bks.ehs_samples)
                };
                serde_json::json!({
                    "street": street, "bucket": bucket,
                    "ehs": if ehs.is_nan() { serde_json::Value::Null } else { serde_json::json!(ehs) },
                })
            };
            if batch {
                let stdin = std::io::stdin();
                for line in stdin.lock().lines() {
                    let line = line.expect("read line");
                    if line.trim().is_empty() {
                        continue;
                    }
                    let q: serde_json::Value = serde_json::from_str(&line).expect("parse query");
                    let result = assign(
                        q["street"].as_str().expect("street"),
                        q["hole"].as_str().expect("hole"),
                        q["board"].as_str().unwrap_or(""),
                    );
                    // Flush per line: batch mode is consumed over a pipe by a
                    // persistent client (stdout is block-buffered when piped).
                    use std::io::Write;
                    println!("{result}");
                    std::io::stdout().flush().expect("flush stdout");
                }
            } else {
                let result = assign(
                    street.as_deref().expect("--street required"),
                    hole.as_deref().expect("--hole required"),
                    board.as_deref().unwrap_or(""),
                );
                jsonl(result);
            }
        }

        Command::Bench { seconds, threads, depth_bb } => {
            let cfg = NlheConfig::default();
            let bconf = solver_kernel::nlhe::BucketConfig {
                flop: 200, turn: 200, river: 200, ehs_samples: 96, boundary_samples: 5_000,
            };
            eprintln!("building throwaway buckets for bench...");
            let buckets = build_buckets(&bconf, 3);
            let trainer = Trainer::new(cfg, depth_bb, buckets);
            let t0 = std::time::Instant::now();
            trainer.train(u64::MAX / 2, Some(Duration::from_secs_f64(seconds)), threads, 5, |_, _| {});
            let iters = trainer.iterations.load(std::sync::atomic::Ordering::Relaxed);
            let ips = iters as f64 / t0.elapsed().as_secs_f64();
            println!(
                "bench: depth={depth_bb}bb threads={threads} iters={iters} ips={ips:.0} infosets={}",
                trainer.store.len()
            );
            jsonl(serde_json::json!({"t": "bench", "ips": ips.round(), "threads": threads, "depth_bb": depth_bb}));
        }
    }
}

use clap::{Parser, Subcommand};
use solver_kernel::br::exploitability;
use solver_kernel::cfr::CfrPlusTrainer;
use solver_kernel::kuhn::Kuhn;
use solver_kernel::leduc::Leduc;

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
        /// Game: kuhn | leduc
        #[arg(long, default_value = "kuhn")]
        game: String,
        #[arg(long, default_value_t = 10_000)]
        iters: u64,
    },
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
    }
}

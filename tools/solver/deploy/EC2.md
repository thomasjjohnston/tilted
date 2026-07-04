# Running the big solve on EC2

The pipeline is machine-agnostic (CLI + files), so a cloud run is just the
same commands on a faster box. A **c7i.8xlarge** (32 vCPU) has roughly
10–15× the sustained throughput of the 2020 MacBook Pro; an until-converged
run that would take the laptop several nights finishes in a few hours.

## Cost ballpark (us-east-1, July 2026)

| Instance      | vCPU | Spot $/hr (approx) | Until-converged run |
|---------------|------|--------------------|---------------------|
| c7i.4xlarge   | 16   | ~$0.30             | ~$2–4 total         |
| c7i.8xlarge   | 32   | ~$0.60             | ~$2–3 total         |
| c8g.8xlarge   | 32   | ~$0.50 (Graviton)  | ~$2–3 total (arm64 works) |

Spot interruptions are a non-event: training checkpoints every chunk, and
`solver run` resumes automatically when you relaunch.

## Runbook

1. **Launch**: Amazon Linux 2023 or Ubuntu 22+, the instance type above,
   spot pricing, your SSH key. No inbound ports needed beyond SSH.
   **Disk: size for the abstraction.** 30 GB gp3 is fine for the default
   config; fine-bucket configs (600+/street) need **150 GB** — checkpoints
   reach several GB per depth, atomic saves transiently double that, and
   the exported artifact adds 5–10 GB. Volumes can also be grown online
   later (console → Volumes → Modify, then `growpart` + `xfs_growfs`).
2. **Bootstrap** (5–10 minutes). Don't `scp -r` the directory — that drags
   ~500 MB of local build artifacts (kernel/target, .venv, runs/) that the
   instance rebuilds anyway. Stream just the source (~76 files, <1 MB):
   ```sh
   cd tools/solver
   tar czf - --exclude=kernel/target --exclude=.venv --exclude=runs \
       --exclude=__pycache__ --exclude=.pytest_cache . \
     | ssh <instance> "mkdir -p solver && tar xzf - -C solver"
   ssh <instance>
   cd solver && bash deploy/ec2-bootstrap.sh
   ```
   (Or git clone your repo and run the script from tools/solver.)
3. **Run** inside tmux (survives disconnects):
   ```sh
   tmux new -s solver
   uv run solver.py run --dir runs/main --until-converged \
       --jobs $(nproc) --threads-per-job 1
   ```
4. **Monitor** from anywhere:
   ```sh
   ssh <instance> "cd solver && ~/.local/bin/uv run solver.py status --dir runs/main"
   ```
5. **Collect** (from your laptop) and shut down:
   ```sh
   scp <instance>:~/solver/runs/main/artifact.sqlite tools/solver/runs/main/
   aws ec2 terminate-instances --instance-ids <id>
   ```
   The artifact file is self-contained (strategies + buckets + config);
   nothing else on the instance matters.

## Notes

- `--jobs $(nproc) --threads-per-job 1` trains many depths concurrently;
  once most depths converge, the runner keeps only stragglers busy — at that
  point restarting with `--jobs 4 --threads-per-job 8` pours all cores into
  the remaining deep trees.
- The buckets file is built once per run dir on first use (a few minutes).
- Keep the laptop and EC2 runs in separate run dirs unless you copy the
  whole dir (checkpoints + buckets.json must stay together).

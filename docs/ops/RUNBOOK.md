# Tilted Ops Runbook

Operational procedures for the Tilted server. Scripts in `docs/ops/scripts/` are intentionally outside `apps/server/src/` so they don't ship in the production Docker image.

All commands assume:
- `cd apps/server` for `pnpm tsx` invocations (scripts use `apps/server/node_modules/.bin/tsx`)
- A shell variable `DB_URL` set to the Neon connection string. Get it from `flyctl secrets list -a tilted-server` (names only) plus the value from your password manager. Quote-wrap to avoid shell line-wrap issues:
  ```bash
  DB_URL='postgresql://neondb_owner:<password>@<host>/neondb?sslmode=require'
  ```

---

## DB drift recovery

We've seen Neon reset state (lost `__drizzle_migrations` rows and/or schema columns) twice already. The scripts below diagnose and patch.

### 1. Inspect current state

```bash
cd apps/server
DATABASE_URL="$DB_URL" pnpm tsx ../../docs/ops/scripts/inspect-migrations.ts
```

Shows: `__drizzle_migrations` rows + `hands` table column list + which migration-0004 columns (`fold_street`, `resolved_net_for_a`, `resolved_net_for_b`) are missing.

Expected healthy state: 6+ rows in `__drizzle_migrations`, all 0004 columns present.

### 2. Re-baseline missing migration tracking

Use when the schema is correct (tables/columns exist) but `__drizzle_migrations` lost rows. Idempotent — only inserts missing hashes.

```bash
DATABASE_URL="$DB_URL" pnpm tsx ../../docs/ops/scripts/baseline-migrations.ts
```

If a newer migration's hash isn't in the script's list, add it (compute via `shasum -a 256 drizzle/000N_*.sql`).

### 3. Add missing 0004 columns

Use when the migration row exists but the columns themselves are absent (the specific failure mode we hit twice).

```bash
DATABASE_URL="$DB_URL" pnpm tsx ../../docs/ops/scripts/fix-missing-0004.ts
```

Idempotent — uses `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.

### 4. Backfill resolved_net for legacy hands

Reconstruct `resolved_net_for_*` from the `actions` table for hands where snapshots are NULL. Run once after a fresh DB rollback or for the first-time bulk fill.

```bash
DATABASE_URL="$DB_URL" pnpm tsx ../../docs/ops/scripts/backfill-resolved-net.ts
```

Reports `rows updated` and a sample of 5 fixed hands. Idempotent: skips rows whose snapshot is already non-NULL.

---

## Deployment

### Manual deploy

From repo root:

```bash
flyctl deploy --remote-only -a tilted-server
```

The `release_command` in `fly.toml` runs `node apps/server/dist/db/migrate.js` before promoting the new image, applying any pending Drizzle migrations. If the migration fails, the deploy aborts.

Smoke-test:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://tilted-server.fly.dev/healthz   # expect 200
```

### Automatic deploys (set up FLY_API_TOKEN)

So future merges to main auto-deploy via CI:

```bash
flyctl auth login
flyctl tokens create deploy -x 999999h
# Copy the FlyV1 fm2_... value
```

In GitHub: **Settings → Secrets and variables → Actions → New repository secret**:
- Name: `FLY_API_TOKEN`
- Value: paste the token

After this, every merge auto-runs `flyctl deploy --remote-only` in CI.

---

## Rotating the Neon password

1. Neon dashboard → **Settings → Roles** → reset password for `neondb_owner`.
2. Copy the full new connection string.
3. Update Fly:
   ```bash
   flyctl secrets set DATABASE_URL='<new connection string>' -a tilted-server
   ```
   This triggers a redeploy with the new credentials.
4. Update your local `DB_URL` shell var to the new string.
5. Verify:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://tilted-server.fly.dev/healthz   # 200
   ```

---

## Drift monitoring (future)

A daily GitHub Action (`.github/workflows/drift-check.yml`, deferred follow-up) runs `inspect-migrations.ts` against prod and opens an issue if drift is detected. If we trip the alarm more than once a month, time to evaluate moving off Neon.

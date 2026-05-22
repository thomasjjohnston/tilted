// One-shot: prints rows in drizzle.__drizzle_migrations so we can see
// what state prod is in. Delete after use.

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL'); process.exit(1); }

const sql = postgres(url, { max: 1, ssl: 'require' });

const rows = await sql<{ id: number; hash_prefix: string; created_at: string }[]>`
  SELECT id, substring(hash, 1, 16) AS hash_prefix, created_at::text
  FROM drizzle.__drizzle_migrations
  ORDER BY created_at
`;
console.log(`Migration tracking rows: ${rows.length}`);
console.table(rows);

const cols = await sql<{ column_name: string }[]>`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'hands' AND table_schema = 'public'
  ORDER BY ordinal_position
`;
console.log(`\nhands table columns: ${cols.length}`);
console.log(cols.map(c => c.column_name).join(', '));

const need = ['fold_street', 'resolved_net_for_a', 'resolved_net_for_b'];
const have = new Set(cols.map(c => c.column_name));
const missing = need.filter(c => !have.has(c));
console.log(`\nMigration 0004 columns missing: ${missing.length === 0 ? 'none ✓' : missing.join(', ')}`);

await sql.end();

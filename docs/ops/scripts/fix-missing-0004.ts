// One-shot: add the columns that migration 0004 was supposed to add
// but are missing from the DB (because the DB was rolled back after
// 0004 ran, while migration-tracking rows survived/were re-baselined).
//
// Idempotent via IF NOT EXISTS. Safe to re-run. Delete after use.

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL'); process.exit(1); }

const sql = postgres(url, { max: 1, ssl: 'require' });

await sql`ALTER TABLE "hands" ADD COLUMN IF NOT EXISTS "fold_street" text`;
console.log('✓ fold_street');
await sql`ALTER TABLE "hands" ADD COLUMN IF NOT EXISTS "resolved_net_for_a" integer`;
console.log('✓ resolved_net_for_a');
await sql`ALTER TABLE "hands" ADD COLUMN IF NOT EXISTS "resolved_net_for_b" integer`;
console.log('✓ resolved_net_for_b');

const cols = await sql<{ column_name: string }[]>`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'hands' AND table_schema = 'public'
    AND column_name IN ('fold_street', 'resolved_net_for_a', 'resolved_net_for_b')
`;
console.log(`\nVerified ${cols.length}/3 columns present.`);

await sql.end();

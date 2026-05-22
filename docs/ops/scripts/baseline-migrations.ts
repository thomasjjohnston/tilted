// One-shot: stamps migrations 0001-0004 as applied in
// drizzle.__drizzle_migrations so the next deploy's release_command
// does nothing (no-op migration). Idempotent — skips hashes that are
// already present. Delete after use.

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL'); process.exit(1); }

const sql = postgres(url, { max: 1, ssl: 'require' });

const baselines: { tag: string; hash: string; createdAt: number }[] = [
  { tag: '0001_charming_payback',       hash: '4f644627eed19c373072577edf98a5c484c426d8a3d41e806cb1018e954c0a9c', createdAt: 1776632447325 },
  { tag: '0002_good_pixie',             hash: 'f99e7563909a6bc824ea2843d14d4ee0033c4f002e4b9e9bb043b83791e3c278', createdAt: 1776711567261 },
  { tag: '0003_gray_raider',            hash: 'e08852a1b5a0c184a2a3fa7de4a1e5cc36b85da5336d8b62c1b9e4937e7b85e6', createdAt: 1776711917663 },
  { tag: '0004_resolved_net_snapshots', hash: '6ac2625db064effc11bd7aef8757e259a469ea40e9ab49b3ec194b43527608e7', createdAt: 1779840000000 },
];

for (const b of baselines) {
  const existing = await sql`SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${b.hash}`;
  if (existing.length > 0) {
    console.log(`✓ ${b.tag} already tracked`);
    continue;
  }
  await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${b.hash}, ${b.createdAt})`;
  console.log(`+ ${b.tag} stamped`);
}

const final = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`;
console.log(`\nNow has ${final[0].count} row(s).`);
await sql.end();

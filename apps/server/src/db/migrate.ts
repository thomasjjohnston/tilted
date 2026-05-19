// Runtime migration runner — invoked by Fly's release_command on every
// deploy, before the new server image is promoted. Uses the migrator
// shipped with drizzle-orm (already a prod dep), so we don't need the
// drizzle-kit dev tooling inside the production image.

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required for migrations');
  process.exit(1);
}

// `max: 1` keeps things conservative — the migration only needs one
// connection and a release_command runs in an ephemeral container.
const client = postgres(url, { max: 1 });
const db = drizzle(client);

const start = Date.now();
await migrate(db, { migrationsFolder: './apps/server/drizzle' });
console.log(`Migrations applied in ${Date.now() - start}ms`);

await client.end();
process.exit(0);

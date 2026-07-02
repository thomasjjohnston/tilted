// One-shot bootstrap for local/container startup: run migrations, then
// seed the baseline users (incl. the Practice Bot). Idempotent — safe to
// run on every `docker compose up`. The compose `server` service runs
// this before `http.js`. (Production/Fly runs migrations via its own
// release_command and does NOT seed.)

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './connection.js';
import { seedUsers } from './seed.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[bootstrap] DATABASE_URL is required');
  process.exit(1);
}

// Resolve the migrations folder relative to this file so it works
// regardless of the working directory. dist/db → ../../drizzle.
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '../../drizzle');

const migClient = postgres(url, { max: 1 });
const start = Date.now();
await migrate(drizzle(migClient), { migrationsFolder });
await migClient.end();
console.log(`[bootstrap] migrations applied in ${Date.now() - start}ms`);

const db = createDb(url);
await seedUsers(db);
console.log('[bootstrap] users seeded (TJ, SL, Practice Bot)');

process.exit(0);

// Vitest globalSetup — starts a single Postgres container shared across
// all integration test workers and runs migrations once. Per-test
// isolation happens in helpers.ts via TRUNCATE.
//
// Skips silently when Docker isn't available so engine-only tests still
// run on machines without Docker.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  if (process.env.SKIP_INTEGRATION_TESTS === 'true') return;

  try {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('tilted_test')
      .withUsername('tilted')
      .withPassword('tilted')
      .start();
    const url = container.getConnectionUri();
    process.env.DATABASE_URL_TEST = url;

    // Run all drizzle migrations once against the shared test DB.
    const client = postgres(url, { max: 1 });
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: './drizzle' });
    await client.end({ timeout: 5 });
  } catch (err) {
    console.warn('[integration setup] Docker not available, skipping integration tests:', (err as Error).message);
  }
}

export async function teardown(): Promise<void> {
  if (container) await container.stop();
}

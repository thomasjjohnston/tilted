import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/integration/setup.ts'],
    // Integration tests spin up a Postgres container in globalSetup, which
    // can take ~10s on a cold start. Engine tests stay fast.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Single fork keeps the shared Postgres test DB free of cross-file
    // race conditions (multiple files calling freshDb() / TRUNCATE
    // concurrently would step on each other). Engine tests are fast
    // enough that serial execution still completes in <5s.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/http.ts', 'src/admin/**'],
    },
  },
});

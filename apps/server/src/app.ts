import Fastify from 'fastify';
import cors from '@fastify/cors';
import { execSync } from 'node:child_process';
import { env } from './env.js';
import { authPlugin } from './api/auth.js';
import { matchRoutes } from './api/routes/match.js';
import { handRoutes } from './api/routes/hand.js';
import { roundRoutes } from './api/routes/round.js';
import { meRoutes } from './api/routes/me.js';
import { historyRoutes } from './api/routes/history.js';

function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      transport: env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  await app.register(cors, { origin: true });

  // Health check (no auth)
  app.get('/healthz', async () => ({
    ok: true,
    commit: getGitSha(),
  }));

  // Auth plugin (registers debug auth routes + bearer middleware)
  await app.register(authPlugin, { prefix: '/v1' });

  // API routes
  await app.register(meRoutes, { prefix: '/v1' });
  await app.register(matchRoutes, { prefix: '/v1' });
  await app.register(handRoutes, { prefix: '/v1' });
  await app.register(roundRoutes, { prefix: '/v1' });
  await app.register(historyRoutes, { prefix: '/v1' });

  return app;
}

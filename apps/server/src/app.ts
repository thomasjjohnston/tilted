import Fastify from 'fastify';
import cors from '@fastify/cors';
import { execSync } from 'node:child_process';
import { env } from './env.js';
import { debugAuthRoutes, bearerAuth } from './api/auth.js';
import { authAppleRoutes } from './api/routes/auth-apple.js';
import { matchRoutes } from './api/routes/match.js';
import { handRoutes } from './api/routes/hand.js';
import { roundRoutes } from './api/routes/round.js';
import { meRoutes } from './api/routes/me.js';
import { historyRoutes } from './api/routes/history.js';
import { matchupRoutes } from './api/routes/matchup.js';
import { usersRoutes } from './api/routes/users.js';

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

  // Unauthenticated sign-in routes
  await app.register(debugAuthRoutes, { prefix: '/v1' });
  await app.register(authAppleRoutes, { prefix: '/v1' });

  // Authenticated API routes
  await app.register(async (authenticated) => {
    // Decorate + hook
    authenticated.decorateRequest('userId', '');
    authenticated.addHook('onRequest', bearerAuth);

    // All authenticated routes
    await authenticated.register(meRoutes);
    await authenticated.register(matchRoutes);
    await authenticated.register(handRoutes);
    await authenticated.register(roundRoutes);
    await authenticated.register(historyRoutes);
    await authenticated.register(matchupRoutes);
    await authenticated.register(usersRoutes);
  }, { prefix: '/v1' });

  return app;
}

import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { execSync } from 'node:child_process';
import { ZodError } from 'zod';
import { env } from './env.js';
import { GameRuleError } from './errors.js';
import { debugAuthRoutes, bearerAuth } from './api/auth.js';
import { authAppleRoutes } from './api/routes/auth-apple.js';
import { authAppleWebhookRoutes } from './api/routes/auth-apple-webhook.js';
import { matchRoutes } from './api/routes/match.js';
import { handRoutes } from './api/routes/hand.js';
import { turnRoutes } from './api/routes/turn.js';
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

  // Central error handler. Illegal *game* actions (below min-raise, not
  // your turn, over-committing the shared stack) are the caller's fault,
  // not ours — return 422 with the message so the client surfaces a real
  // error instead of a silent 500 that reads as "the hand bounced back"
  // (beta feedback S7-4). Malformed requests → 400. Everything else → 500.
  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (error instanceof GameRuleError) {
      return reply.status(422).send({ error: 'GameRuleError', message: error.message });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Invalid request', issues: error.issues });
    }
    if (error.validation) {
      return reply.status(400).send({ error: 'BadRequest', message: error.message });
    }
    req.log.error(error);
    const status = error.statusCode ?? 500;
    return reply.status(status).send({
      error: status === 500 ? 'InternalServerError' : 'RequestError',
      message: status === 500 ? 'Internal Server Error' : error.message,
    });
  });

  // Health check (no auth)
  app.get('/healthz', async () => ({
    ok: true,
    commit: getGitSha(),
  }));

  // Unauthenticated sign-in routes. Apple auth is rate-limited per IP
  // (5/minute) since it's DoS-adjacent — attacker hitting it costs us
  // an Apple JWKS fetch each time.
  await app.register(debugAuthRoutes, { prefix: '/v1' });
  await app.register(async (scope) => {
    await scope.register(rateLimit, {
      max: 5,
      timeWindow: '1 minute',
    });
    await scope.register(authAppleRoutes);
  }, { prefix: '/v1' });

  // Apple server-to-server notifications (no bearer — Apple signs the payload)
  await app.register(authAppleWebhookRoutes, { prefix: '/v1' });

  // Authenticated API routes
  await app.register(async (authenticated) => {
    // Decorate + hook
    authenticated.decorateRequest('userId', '');
    authenticated.addHook('onRequest', bearerAuth);

    // All authenticated routes
    await authenticated.register(meRoutes);
    await authenticated.register(matchRoutes);
    await authenticated.register(handRoutes);
    await authenticated.register(turnRoutes);
    await authenticated.register(roundRoutes);
    await authenticated.register(historyRoutes);
    await authenticated.register(matchupRoutes);
    await authenticated.register(usersRoutes);
  }, { prefix: '/v1' });

  return app;
}

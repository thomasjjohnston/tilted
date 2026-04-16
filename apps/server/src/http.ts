import { env } from './env.js';
import { buildApp } from './app.js';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Tilted server listening on port ${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

import { env } from './env.js';
import { buildApp } from './app.js';
import { getDb } from './api/context.js';
import { startReminderLoop } from './notif/reminder-cron.js';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Tilted server listening on port ${env.PORT}`);

  // Kick off the 6h-reminder scanner. Safe to run in dev too — without
  // an APNS key, dispatch() stubs out, so the loop is a no-op besides
  // marking fired_at.
  if (env.NODE_ENV === 'production') {
    startReminderLoop(getDb());
    app.log.info('Reminder loop started (5 min interval)');
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

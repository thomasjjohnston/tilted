import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  APNS_KEY: z.string().default(''),
  APNS_KEY_ID: z.string().default(''),
  APNS_TEAM_ID: z.string().default(''),
  APNS_BUNDLE_ID: z.string().default('com.thomasjjohnston.tilted'),
  // Public origin used in share links (invites). No trailing slash.
  PUBLIC_BASE_URL: z.string().url().default('https://tilted-server.fly.dev'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Opens POST /v1/auth/debug/select, which mints a bearer for any user_id
  // with no proof of identity. Local dev stack only — never set in production.
  ENABLE_DEBUG_AUTH: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
});

export const env = envSchema.parse(process.env);

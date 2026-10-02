import { randomBytes, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { debugTokens } from '../db/schema.js';

/** A bearer unused for this long stops working; any use resets the clock. */
export const TOKEN_IDLE_TTL_DAYS = 90;

/** How stale last_used_at may get before a request bothers to rewrite it. */
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Issue a new bearer for the user. Only the hash is stored. */
export async function mintToken(db: Database, userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db.insert(debugTokens).values({ tokenHash: hashToken(token), userId });
  return token;
}

/**
 * Resolve a bearer to its user, enforcing the idle TTL. Returns null for
 * unknown or expired tokens (expired rows are deleted on sight).
 */
export async function resolveToken(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<{ userId: string; tokenHash: string } | null> {
  const tokenHash = hashToken(token);
  const row = await db.query.debugTokens.findFirst({
    where: eq(debugTokens.tokenHash, tokenHash),
  });
  if (!row) return null;

  const idleMs = now.getTime() - row.lastUsedAt.getTime();
  if (idleMs > TOKEN_IDLE_TTL_DAYS * DAY_MS) {
    await db.delete(debugTokens).where(eq(debugTokens.tokenHash, tokenHash));
    return null;
  }
  if (idleMs > TOUCH_INTERVAL_MS) {
    await db.update(debugTokens).set({ lastUsedAt: now }).where(eq(debugTokens.tokenHash, tokenHash));
  }
  return { userId: row.userId, tokenHash };
}

export async function revokeToken(db: Database, tokenHash: string): Promise<void> {
  await db.delete(debugTokens).where(eq(debugTokens.tokenHash, tokenHash));
}

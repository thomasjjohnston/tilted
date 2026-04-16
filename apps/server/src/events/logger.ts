import type { Database, Transaction } from '../db/connection.js';
import { appEvents } from '../db/schema.js';

/**
 * Log an app event for observability.
 */
export async function logEvent(
  db: Database | Transaction,
  userId: string | null,
  kind: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(appEvents).values({
    userId: userId,
    kind,
    payload,
  });
}

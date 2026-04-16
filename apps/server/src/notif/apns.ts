import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { getDb } from '../api/context.js';
import { env } from '../env.js';

/**
 * Dispatch a push notification for a turn handoff.
 *
 * Uses APNS HTTP/2 JWT auth flow. The push ID is derived from
 * the handoff_id for idempotent retries.
 *
 * In development/test mode, this just logs the push.
 */
export async function dispatchPush(
  toUserId: string,
  handoffId: string,
  roundId: string,
): Promise<void> {
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.userId, toUserId),
  });

  if (!user?.apnsToken) {
    console.log(`[APNS] No token for user ${toUserId}, skipping push`);
    return;
  }

  // In development, just log
  if (env.NODE_ENV !== 'production' || !env.APNS_KEY) {
    console.log(`[APNS] Would send push to ${user.displayName}: Turn handoff (handoff_id=${handoffId})`);
    return;
  }

  // Production APNS dispatch
  await sendApnsPush(user.apnsToken, handoffId, {
    aps: {
      alert: {
        title: 'Tilted',
        body: `Your turn! Hands are waiting for you.`,
      },
      sound: 'default',
      category: 'TURN_HANDOFF',
    },
    handoff_id: handoffId,
    round_id: roundId,
  });
}

async function sendApnsPush(
  deviceToken: string,
  pushId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const jwt = await generateApnsJwt();
  const isProduction = env.NODE_ENV === 'production';
  const host = isProduction
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';

  const response = await fetch(`${host}/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      'Authorization': `bearer ${jwt}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-id': pushId,
      'apns-priority': '10',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`APNS error ${response.status}: ${body}`);
  }
}

/**
 * Generate a JWT for APNS authentication.
 * Uses ES256 signing with the team's APNS key.
 */
async function generateApnsJwt(): Promise<string> {
  const header = Buffer.from(JSON.stringify({
    alg: 'ES256',
    kid: env.APNS_KEY_ID,
  })).toString('base64url');

  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({
    iss: env.APNS_TEAM_ID,
    iat: now,
  })).toString('base64url');

  const signingInput = `${header}.${claims}`;

  // Use Node's crypto to sign with ES256
  const { createSign } = await import('node:crypto');
  const sign = createSign('SHA256');
  sign.update(signingInput);
  const signature = sign.sign(env.APNS_KEY, 'base64url');

  return `${signingInput}.${signature}`;
}

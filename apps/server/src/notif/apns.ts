import { env } from '../env.js';

/**
 * Send a raw APNS push payload.
 *
 * Uses APNS HTTP/2 JWT auth flow. The caller supplies a deterministic
 * `pushId` (used as the `apns-id` header) so retries are idempotent
 * at Apple's edge.
 *
 * In development or without an APNS_KEY secret, this is a no-op that logs.
 */
export async function sendApnsPush(
  deviceToken: string,
  pushId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (env.NODE_ENV !== 'production' || !env.APNS_KEY) {
    console.log(`[APNS] stub pushId=${pushId} payload=${JSON.stringify(payload)}`);
    return;
  }

  const jwt = await generateApnsJwt();
  const host = 'https://api.push.apple.com';

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

  const { createSign } = await import('node:crypto');
  const sign = createSign('SHA256');
  sign.update(signingInput);
  const signature = sign.sign(env.APNS_KEY, 'base64url');

  return `${signingInput}.${signature}`;
}

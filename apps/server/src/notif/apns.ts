import { connect, constants as http2Constants } from 'node:http2';
import { createHash } from 'node:crypto';
import { env } from '../env.js';

const APNS_HOST = 'https://api.push.apple.com';

/**
 * APNS requires the `apns-id` header to be a canonical UUID
 * (8-4-4-4-12 hex). Our internal dedupe keys are slugs like
 * `handoff:<uuid>` — not UUIDs. Hash to a stable UUID so retries of
 * the same dedupeKey still get Apple-side deduplication.
 */
function dedupeKeyToApnsId(key: string): string {
  const hash = createHash('sha1').update(key).digest();
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Send a raw APNS push payload.
 *
 * APNS requires HTTP/2; Node's built-in fetch is HTTP/1.1, so we
 * use the `node:http2` module directly. A fresh connection per push
 * is fine at MVP volume (2 users). The `pushId` header (apns-id) is
 * deterministic so Apple deduplicates retries at the edge.
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
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const client = connect(APNS_HOST);

    const cleanup = (err?: Error) => {
      client.close();
      if (err) reject(err);
    };

    client.on('error', cleanup);

    const req = client.request({
      [http2Constants.HTTP2_HEADER_METHOD]: 'POST',
      [http2Constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
      [http2Constants.HTTP2_HEADER_SCHEME]: 'https',
      authorization: `bearer ${jwt}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-id': dedupeKeyToApnsId(pushId),
      'apns-priority': '10',
    });

    let status = 0;
    let responseBody = '';

    req.on('response', (headers) => {
      status = Number(headers[http2Constants.HTTP2_HEADER_STATUS] ?? 0);
    });
    req.on('data', (chunk) => {
      responseBody += chunk.toString('utf8');
    });
    req.on('end', () => {
      client.close();
      if (status >= 200 && status < 300) {
        resolve();
      } else {
        reject(new Error(`APNS error ${status}: ${responseBody}`));
      }
    });
    req.on('error', cleanup);

    req.setTimeout(10_000, () => {
      req.close();
      cleanup(new Error('APNS request timed out after 10s'));
    });

    req.write(body);
    req.end();
  });
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

  // JWTs require the raw R||S (IEEE P1363) encoding for ES256.
  // Node's default sign output is DER — Apple rejects DER-encoded
  // signatures as InvalidProviderToken.
  const { createSign } = await import('node:crypto');
  const sign = createSign('SHA256');
  sign.update(signingInput);
  const signature = sign.sign({
    key: env.APNS_KEY,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');

  return `${signingInput}.${signature}`;
}

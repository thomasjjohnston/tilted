import { createPublicKey, createVerify } from 'node:crypto';

/**
 * Verify an Apple Sign in with Apple identity token.
 *
 * Apple's JWKS at https://appleid.apple.com/auth/keys lists rotating
 * RSA public keys. We cache the set in memory and refresh on miss or
 * after 1h.
 */

const JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';
const JWKS_TTL_MS = 60 * 60 * 1000;

interface JWK extends Record<string, unknown> {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
}

interface JWKSCache {
  keys: JWK[];
  fetchedAt: number;
}

let jwksCache: JWKSCache | null = null;

async function fetchJwks(): Promise<JWK[]> {
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Apple JWKS fetch failed: ${res.status}`);
  const body = await res.json() as { keys: JWK[] };
  return body.keys;
}

async function getKey(kid: string): Promise<JWK> {
  const now = Date.now();
  const cacheValid = jwksCache && (now - jwksCache.fetchedAt) < JWKS_TTL_MS;
  if (cacheValid) {
    const hit = jwksCache!.keys.find(k => k.kid === kid);
    if (hit) return hit;
  }

  // Miss or expired — refresh
  const keys = await fetchJwks();
  jwksCache = { keys, fetchedAt: now };
  const hit = keys.find(k => k.kid === kid);
  if (!hit) throw new Error(`Apple key ${kid} not found in JWKS`);
  return hit;
}

/** Internal: reset the cache — used by tests. */
export function __resetJwksCache(): void {
  jwksCache = null;
}

/** Internal: seed the cache — used by tests. */
export function __seedJwksCache(keys: JWK[]): void {
  jwksCache = { keys, fetchedAt: Date.now() };
}

export interface VerifiedAppleIdentity {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  isPrivateEmail?: boolean;
}

interface JWTHeader {
  alg: string;
  kid: string;
  typ?: string;
}

interface JWTClaims {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  nonce?: string;
}

/**
 * Verify an Apple identity token and return the authenticated identity.
 * Throws if the token is malformed, expired, or doesn't match our expected audience.
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
  expectedAudience: string,
): Promise<VerifiedAppleIdentity> {
  const parts = identityToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const [headerB64, claimsB64, signatureB64] = parts;

  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as JWTHeader;
  if (header.alg !== 'RS256') throw new Error(`Unexpected JWT alg: ${header.alg}`);

  const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf8')) as JWTClaims;

  if (claims.iss !== APPLE_ISSUER) throw new Error(`Bad issuer: ${claims.iss}`);
  if (claims.aud !== expectedAudience) throw new Error(`Bad audience: ${claims.aud}`);

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) throw new Error('JWT expired');
  if (claims.iat > now + 60) throw new Error('JWT issued in the future');

  const jwk = await getKey(header.kid);
  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });

  const verifier = createVerify('SHA256');
  verifier.update(`${headerB64}.${claimsB64}`);
  const signature = Buffer.from(signatureB64, 'base64url');
  const ok = verifier.verify(publicKey, signature);
  if (!ok) throw new Error('JWT signature invalid');

  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: toBool(claims.email_verified),
    isPrivateEmail: toBool(claims.is_private_email),
  };
}

function toBool(v: boolean | string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  return v === 'true';
}

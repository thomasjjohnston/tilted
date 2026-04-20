import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync, createSign } from 'node:crypto';
import {
  verifyAppleIdentityToken,
  __resetJwksCache,
  __seedJwksCache,
} from '../../src/auth/apple-jwt.js';

const AUD = 'com.thomasjjohnston.tilted';
const ISS = 'https://appleid.apple.com';

function generateRsaJwk() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    privateKey,
    jwk: { ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' },
  };
}

function signToken(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], header: object, claims: object): string {
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const claimsB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${headerB64}.${claimsB64}`;
  const sign = createSign('SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

describe('verifyAppleIdentityToken', () => {
  let privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  let jwk: Record<string, unknown>;

  beforeEach(() => {
    __resetJwksCache();
    const kp = generateRsaJwk();
    privateKey = kp.privateKey;
    jwk = kp.jwk;
    __seedJwksCache([jwk as never]);
  });

  it('verifies a valid token and returns sub + email', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken(privateKey, { alg: 'RS256', kid: 'test-kid' }, {
      iss: ISS,
      aud: AUD,
      exp: now + 3600,
      iat: now,
      sub: 'apple-user-001',
      email: 'user@example.com',
      email_verified: 'true',
    });

    const result = await verifyAppleIdentityToken(token, AUD);
    expect(result.sub).toBe('apple-user-001');
    expect(result.email).toBe('user@example.com');
    expect(result.emailVerified).toBe(true);
  });

  it('rejects a token with wrong audience', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken(privateKey, { alg: 'RS256', kid: 'test-kid' }, {
      iss: ISS,
      aud: 'com.imposter.app',
      exp: now + 3600,
      iat: now,
      sub: 'apple-user-001',
    });
    await expect(verifyAppleIdentityToken(token, AUD)).rejects.toThrow(/Bad audience/);
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken(privateKey, { alg: 'RS256', kid: 'test-kid' }, {
      iss: ISS,
      aud: AUD,
      exp: now - 60,
      iat: now - 3600,
      sub: 'apple-user-001',
    });
    await expect(verifyAppleIdentityToken(token, AUD)).rejects.toThrow(/expired/);
  });

  it('rejects a token with forged signature', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken(privateKey, { alg: 'RS256', kid: 'test-kid' }, {
      iss: ISS,
      aud: AUD,
      exp: now + 3600,
      iat: now,
      sub: 'apple-user-001',
    });
    // Swap in a signature from a different key
    const otherKp = generateRsaJwk();
    const [headerB64, claimsB64] = token.split('.');
    const sign = createSign('SHA256');
    sign.update(`${headerB64}.${claimsB64}`);
    const forged = sign.sign(otherKp.privateKey).toString('base64url');
    const badToken = `${headerB64}.${claimsB64}.${forged}`;
    await expect(verifyAppleIdentityToken(badToken, AUD)).rejects.toThrow(/signature invalid/);
  });

  it('rejects a malformed token', async () => {
    await expect(verifyAppleIdentityToken('not-a-jwt', AUD)).rejects.toThrow(/Invalid JWT/);
  });

  it('rejects a token with wrong issuer', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken(privateKey, { alg: 'RS256', kid: 'test-kid' }, {
      iss: 'https://attacker.com',
      aud: AUD,
      exp: now + 3600,
      iat: now,
      sub: 'apple-user-001',
    });
    await expect(verifyAppleIdentityToken(token, AUD)).rejects.toThrow(/Bad issuer/);
  });
});

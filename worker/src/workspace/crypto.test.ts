import { describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret, fromBase64Url, verifyGoogleIdentityToken } from './crypto';
import type { WorkspaceEnv } from './types';

const rawKey = crypto.getRandomValues(new Uint8Array(32));
const key = btoa(String.fromCharCode(...rawKey));
const env = {
  TOKEN_ENCRYPTION_KEYS: JSON.stringify({ v1: key }), TOKEN_ENCRYPTION_KEY_VERSION: 'v1',
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
} as WorkspaceEnv;

describe('Workspace credential encryption', () => {
  it('round trips with a unique nonce and context binding', async () => {
    const first = await encryptSecret(env, 'refresh-secret', 'connection:admin@example.org');
    const second = await encryptSecret(env, 'refresh-secret', 'connection:admin@example.org');
    expect(first.nonce).not.toBe(second.nonce);
    expect(await decryptSecret(env, first, 'connection:admin@example.org')).toBe('refresh-secret');
    await expect(decryptSecret(env, first, 'connection:other@example.org')).rejects.toThrow();
  });

  it('rejects an unknown key version', async () => {
    await expect(decryptSecret(env, { keyVersion: 'v2', nonce: 'AA', ciphertext: 'AA' }, 'ctx')).rejects.toThrow('unavailable');
  });
});

describe('Google identity token verification', () => {
  it('checks signature, audience, nonce, issuer, expiry and verified email', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey & { kid?: string };
    publicJwk.kid = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [publicJwk] })));
    const encode = (value: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    };
    const header = encode({ alg: 'RS256', kid: 'test-key' });
    const payload = encode({ iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000), nonce: 'nonce-123', email: 'admin@example.org', email_verified: true, sub: 'google-sub', hd: 'example.org' });
    const unsigned = `${header}.${payload}`;
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned)));
    let binary = ''; for (const byte of signature) binary += String.fromCharCode(byte);
    const token = `${unsigned}.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
    await expect(verifyGoogleIdentityToken(token, env, 'nonce-123')).resolves.toMatchObject({ email: 'admin@example.org', hostedDomain: 'example.org' });
    await expect(verifyGoogleIdentityToken(token, env, 'wrong-nonce')).rejects.toThrow('could not be verified');
    expect(fromBase64Url('AQID')).toEqual(new Uint8Array([1, 2, 3]));
    vi.unstubAllGlobals();
  });
});

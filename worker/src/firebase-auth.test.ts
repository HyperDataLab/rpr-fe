import { describe, expect, it, vi } from 'vitest';
import { verifyFirebaseToken } from './index';

function encode(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

describe('Firebase ID token verification', () => {
  it('accepts the configured project token and rejects expired or invalid tokens', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey & { kid?: string };
    jwk.kid = 'firebase-test-key';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [jwk] })));
    const projectId = 'firebase-test-project';
    const token = async (expiry: number, sign = true) => {
      const header = encode({ alg: 'RS256', kid: 'firebase-test-key' });
      const payload = encode({ aud: projectId, iss: `https://securetoken.google.com/${projectId}`, sub: 'user-123', exp: expiry, iat: Math.floor(Date.now() / 1000) });
      const data = new TextEncoder().encode(`${header}.${payload}`);
      const signature = sign ? new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, data)) : new Uint8Array(256);
      let binary = ''; for (const byte of signature) binary += String.fromCharCode(byte);
      return `${header}.${payload}.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
    };
    const env = { FIREBASE_PROJECT_ID: projectId } as Parameters<typeof verifyFirebaseToken>[1];
    const validRequest = new Request('https://worker.test/protected', { headers: { authorization: `Bearer ${await token(Math.floor(Date.now() / 1000) + 300)}` } });
    await expect(verifyFirebaseToken(validRequest, env)).resolves.toMatchObject({ sub: 'user-123', aud: projectId });
    const expiredRequest = new Request('https://worker.test/protected', { headers: { authorization: `Bearer ${await token(Math.floor(Date.now() / 1000) - 1)}` } });
    await expect(verifyFirebaseToken(expiredRequest, env)).rejects.toMatchObject({ status: 401 });
    const invalidRequest = new Request('https://worker.test/protected', { headers: { authorization: `Bearer ${await token(Math.floor(Date.now() / 1000) + 300, false)}` } });
    await expect(verifyFirebaseToken(invalidRequest, env)).rejects.toMatchObject({ status: 401 });
    vi.unstubAllGlobals();
  });
});

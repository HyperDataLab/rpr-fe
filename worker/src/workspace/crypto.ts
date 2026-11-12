import type { WorkspaceEnv } from './types';

const encoder = new TextEncoder();
const bufferSource = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export async function createPkceChallenge(verifier: string): Promise<string> {
  return sha256(verifier);
}

export async function createFirebaseCustomToken(env: WorkspaceEnv, uid: string): Promise<string> {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('Firebase custom-token signing is not configured.');
  let serviceAccount: { project_id?: string; client_email?: string; private_key?: string; type?: string };
  try { serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as typeof serviceAccount; }
  catch { throw new Error('Firebase service-account configuration is invalid.'); }
  if (serviceAccount.type !== 'service_account' || serviceAccount.project_id !== env.FIREBASE_PROJECT_ID
    || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Firebase service-account configuration does not match the project.');
  }

  const pem = serviceAccount.private_key.replace(/\\n/g, '\n');
  const encodedKey = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const keyBytes = Uint8Array.from(atob(encodedKey), (char) => char.charCodeAt(0));
  const signingKey = await crypto.subtle.importKey('pkcs8', bufferSource(keyBytes), {
    name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256',
  }, false, ['sign']);
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: issuedAt,
    exp: issuedAt + 3600,
    uid,
  })));
  const unsignedToken = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', signingKey, new TextEncoder().encode(unsignedToken),
  ));
  return `${unsignedToken}.${base64Url(signature)}`;
}

export async function createFirebaseServiceAccessToken(env: WorkspaceEnv, scope: string): Promise<string> {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('Firebase service-account access is not configured.');
  let serviceAccount: { project_id?: string; client_email?: string; private_key?: string; type?: string };
  try { serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as typeof serviceAccount; }
  catch { throw new Error('Firebase service-account configuration is invalid.'); }
  if (serviceAccount.type !== 'service_account' || serviceAccount.project_id !== env.FIREBASE_PROJECT_ID
    || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Firebase service-account configuration does not match the project.');
  }

  const pem = serviceAccount.private_key.replace(/\\n/g, '\n');
  const encodedKey = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const keyBytes = Uint8Array.from(atob(encodedKey), (char) => char.charCodeAt(0));
  const signingKey = await crypto.subtle.importKey('pkcs8', bufferSource(keyBytes), {
    name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256',
  }, false, ['sign']);
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64Url(encoder.encode(JSON.stringify({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600,
  })));
  const unsignedAssertion = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', signingKey, encoder.encode(unsignedAssertion),
  ));
  const assertion = `${unsignedAssertion}.${base64Url(signature)}`;
  const result = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(12000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = await result.json().catch(() => null) as { access_token?: string } | null;
  if (!result.ok || !body?.access_token) throw new Error('Could not obtain Firebase service-account access.');
  return body.access_token;
}

function keyFor(env: WorkspaceEnv, version: string): Promise<CryptoKey> {
  let keys: Record<string, string>;
  try { keys = JSON.parse(env.TOKEN_ENCRYPTION_KEYS) as Record<string, string>; }
  catch { throw new Error('Workspace token encryption keyring is misconfigured.'); }
  const encoded = keys[version];
  if (!encoded) throw new Error(`Workspace token encryption key version ${version} is unavailable.`);
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  if (bytes.byteLength !== 32) throw new Error('Workspace token encryption keys must decode to exactly 32 bytes.');
  return crypto.subtle.importKey('raw', bufferSource(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export interface Ciphertext {
  keyVersion: string;
  nonce: string;
  ciphertext: string;
}

export async function encryptSecret(env: WorkspaceEnv, value: string, context: string): Promise<Ciphertext> {
  const keyVersion = env.TOKEN_ENCRYPTION_KEY_VERSION;
  if (!keyVersion) throw new Error('Workspace token encryption key version is not configured.');
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(env, keyVersion);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: bufferSource(nonce), additionalData: bufferSource(encoder.encode(`researchpulse:${context}:${keyVersion}`)), tagLength: 128,
  }, key, bufferSource(encoder.encode(value)));
  return { keyVersion, nonce: base64Url(nonce), ciphertext: base64Url(new Uint8Array(ciphertext)) };
}

export async function decryptSecret(env: WorkspaceEnv, value: Ciphertext, context: string): Promise<string> {
  const key = await keyFor(env, value.keyVersion);
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: bufferSource(fromBase64Url(value.nonce)),
    additionalData: bufferSource(encoder.encode(`researchpulse:${context}:${value.keyVersion}`)), tagLength: 128,
  }, key, bufferSource(fromBase64Url(value.ciphertext)));
  return new TextDecoder().decode(plaintext);
}

export function parseJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Google identity token is malformed.');
  return JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]))) as Record<string, unknown>;
}

export async function verifyGoogleIdentityToken(token: string, env: WorkspaceEnv, expectedNonce: string) {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('Google identity token is malformed.');
  const header = JSON.parse(new TextDecoder().decode(fromBase64Url(headerPart))) as { alg?: string; kid?: string };
  const claims = parseJwtPayload(token);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Google identity token algorithm is invalid.');
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Unable to verify Google identity token.');
  const jwks = await response.json() as { keys?: JsonWebKey[] };
  const jwk = jwks.keys?.find((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid);
  if (!jwk) throw new Error('Google identity token signing key is unknown.');
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, bufferSource(fromBase64Url(signaturePart)), bufferSource(encoder.encode(`${headerPart}.${payloadPart}`)));
  const now = Math.floor(Date.now() / 1000);
  const issuerValid = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!valid || !issuerValid || claims.aud !== env.GOOGLE_CLIENT_ID || Number(claims.exp) <= now
    || Number(claims.iat) > now + 60 || claims.nonce !== expectedNonce || claims.email_verified !== true
    || typeof claims.email !== 'string' || typeof claims.sub !== 'string') {
    throw new Error('Google identity could not be verified.');
  }
  return { email: claims.email.toLowerCase(), subject: claims.sub, hostedDomain: typeof claims.hd === 'string' ? claims.hd.toLowerCase() : '' };
}

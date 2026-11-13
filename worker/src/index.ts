interface R2ObjectBody {
  body: ReadableStream;
  httpEtag?: string;
  httpMetadata?: { contentType?: string };
  size: number;
  range?: { offset?: number; length?: number };
}

interface R2BucketBinding {
  get(key: string, options?: { range?: Headers }): Promise<R2ObjectBody | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: {
    httpMetadata?: { contentType?: string };
  }): Promise<unknown>;
  delete(key: string): Promise<void>;
}

interface Env {
  PUBLICATION_PDFS: R2BucketBinding;
  PRIVATE_NETWORK: {
    fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  };
  FIREBASE_PROJECT_ID: string;
  FIREBASE_WEB_API_KEY?: string;
  FRONTEND_ORIGINS: string;
  GROBID_ORIGIN: string;
  GROBID_GATEWAY_TOKEN?: string;
  DB: import('./workspace/types').D1Database;
  ALLOWED_ORIGINS?: string;
  FRONTEND_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_WORKSPACE_DOMAIN?: string;
  GOOGLE_ADMIN_EMAILS?: string;
  TOKEN_ENCRYPTION_KEYS?: string;
  TOKEN_ENCRYPTION_KEY_VERSION?: string;
  WORKSPACE_DELETE_ENABLED?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

import { handleWorkspaceRequest } from './workspace';

interface FirebaseClaims {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
}

interface FirestoreDocument {
  fields?: Record<string, unknown>;
}

interface FirestoreIdentity {
  uid: string;
  role: 'ADMIN' | 'LECTURER' | 'STUDENT';
}

const grobidPath = '/api/processHeaderDocument';
const maxPdfBytes = 50 * 1024 * 1024;
const jwksUrl = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache: { expiresAt: number; keys: JsonWebKey[] } | null = null;

function json(body: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  responseHeaders.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeBase64UrlJson(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Record<string, unknown>;
}

async function firebaseKeys(): Promise<JsonWebKey[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(jwksUrl, { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
  if (!response.ok) throw new Error('Unable to load Firebase token verification keys.');
  const body = await response.json() as { keys?: JsonWebKey[] };
  if (!Array.isArray(body.keys)) throw new Error('Firebase token verification keys are invalid.');
  jwksCache = { keys: body.keys, expiresAt: Date.now() + 50 * 60 * 1000 };
  return body.keys;
}

export async function verifyFirebaseToken(request: Request, env: Env): Promise<FirebaseClaims> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Response('Firebase authentication is required.', { status: 401 });
  const parts = token.split('.');
  if (parts.length !== 3) throw new Response('Invalid Firebase ID token.', { status: 401 });
  const header = decodeBase64UrlJson(parts[0]);
  const claims = decodeBase64UrlJson(parts[1]) as unknown as FirebaseClaims;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Response('Invalid Firebase ID token.', { status: 401 });
  }
  const jwk = (await firebaseKeys()).find((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid);
  if (!jwk) throw new Response('Firebase ID token signing key is unknown.', { status: 401 });
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const validSignature = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    base64UrlToBytes(parts[2]).buffer as ArrayBuffer,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`).buffer as ArrayBuffer,
  );
  const now = Math.floor(Date.now() / 1000);
  if (!validSignature || claims.aud !== env.FIREBASE_PROJECT_ID
    || claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`
    || !claims.sub || claims.exp <= now || claims.iat > now + 60) {
    throw new Response('Firebase ID token is invalid or expired.', { status: 401 });
  }
  return claims;
}

function firestoreValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const fields = value as Record<string, unknown>;
  if ('stringValue' in fields) return fields.stringValue;
  if ('integerValue' in fields) return Number(fields.integerValue);
  if ('doubleValue' in fields) return fields.doubleValue;
  if ('booleanValue' in fields) return fields.booleanValue;
  if ('timestampValue' in fields) return fields.timestampValue;
  if ('nullValue' in fields) return null;
  if ('arrayValue' in fields) {
    const values = (fields.arrayValue as { values?: unknown[] } | undefined)?.values || [];
    return values.map(firestoreValue);
  }
  if ('mapValue' in fields) {
    const nested = (fields.mapValue as { fields?: Record<string, unknown> } | undefined)?.fields || {};
    return Object.fromEntries(Object.entries(nested).map(([key, item]) => [key, firestoreValue(item)]));
  }
  return value;
}

function documentFields(document: FirestoreDocument | null): Record<string, unknown> | null {
  if (!document?.fields) return null;
  return Object.fromEntries(Object.entries(document.fields).map(([key, value]) => [key, firestoreValue(value)]));
}

async function firestoreGet(env: Env, token: string | undefined, collection: string, id: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(url, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Response('Unable to validate Firestore access.', { status: 502 });
  return documentFields(await response.json() as FirestoreDocument);
}

async function firestoreCreate(env: Env, collection: string, id: string, values: Record<string, unknown>) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${collection}?documentId=${encodeURIComponent(id)}`;
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Response('Could not save your registration request.', { status: 502 });
}

function encodeFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encodeFirestoreValue(item)])) } };
  }
  return { stringValue: String(value) };
}

async function registerAccount(request: Request, env: Env) {
  const input = await request.json().catch(() => null) as {
    firstName?: string; lastName?: string; email?: string; studentId?: string; major?: string; phone?: string;
  } | null;
  const firstName = input?.firstName?.trim() || '';
  const lastName = input?.lastName?.trim() || '';
  const email = input?.email?.trim().toLowerCase() || '';
  const studentId = input?.studentId?.trim() || '';
  const major = input?.major?.trim() || '';
  const phone = input?.phone?.trim() || '';
  if (!firstName || !lastName || !studentId || !major || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Response('Complete all required registration fields with a valid email.', { status: 400 });
  }
  const now = new Date().toISOString();
  const requestId = crypto.randomUUID();
  // Registration only records the applicant's details. Firebase Auth and the
  // application profile are created later, after admin approval and Workspace linking.
  await firestoreCreate(env, 'registrationRequests', requestId, {
    email, firstName, lastName, studentId, major, ...(phone ? { phone } : {}),
    status: 'PENDING', createdAt: now,
  });
  const name = `${firstName} ${lastName}`.trim();
  return json({ success: true, requestId, user: { email, name }, message: 'Registration request received. An administrator will review it and contact you by email.' }, 201);
}

async function sendAccountSetupLink(request: Request, env: Env, identity: FirestoreIdentity, token: string) {
  if (identity.role !== 'ADMIN') throw new Response('Admin access is required.', { status: 403 });
  if (!env.FIREBASE_WEB_API_KEY) throw new Response('Firebase Auth is not configured on the Worker.', { status: 503 });
  const body = await request.json().catch(() => null) as { userId?: string } | null;
  const userId = body?.userId || '';
  if (!userId) throw new Response('userId is required.', { status: 400 });
  const profile = await firestoreGet(env, token, 'userProfiles', userId);
  if (!profile || profile.status !== 'APPROVED' || profile.isActive !== true || typeof profile.email !== 'string') {
    throw new Response('The account must be approved before sending its setup link.', { status: 409 });
  }
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestType: 'PASSWORD_RESET',
      email: profile.email,
      continueUrl: `${env.FRONTEND_ORIGINS.split(',').map((item) => item.trim()).find(Boolean) || 'http://localhost:3003'}/forgot-password`,
    }),
  });
  if (!response.ok) throw new Response('Could not send the account setup email.', { status: 502 });
  return json({ success: true, message: 'Account setup email sent.' });
}

async function firestoreQuery(
  env: Env,
  token: string | undefined,
  collection: string,
  field: string,
  value: string,
  additionalFilters: Array<{ field: string; value: string }> = [],
  maxResults = 50,
) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${collection}:runQuery`;
  const fieldFilters = [{ field, value }, ...additionalFilters].map((filter) => ({
    fieldFilter: { field: { fieldPath: filter.field }, op: 'EQUAL', value: { stringValue: filter.value } },
  }));
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: collection }],
      where: fieldFilters.length === 1
        ? fieldFilters[0]
        : { compositeFilter: { op: 'AND', filters: fieldFilters } },
      limit: maxResults,
    } }),
  });
  if (!response.ok) throw new Response('Unable to validate Firestore access.', { status: 502 });
  const rows = await response.json() as Array<{ document?: FirestoreDocument & { name?: string } }>;
  return rows.flatMap((row) => {
    const fields = documentFields(row.document || null);
    if (!fields) return [];
    const id = row.document?.name?.split('/').pop();
    return [{ ...fields, id } as Record<string, unknown>];
  });
}

async function requireIdentity(request: Request, env: Env, token: string) {
  const claims = await verifyFirebaseToken(request, env);
  const profile = await firestoreGet(env, token, 'userProfiles', claims.sub);
  if (!profile || profile.isActive !== true || profile.status !== 'APPROVED') {
    throw new Response('An approved account is required.', { status: 403 });
  }
  const role = profile.role;
  if (role !== 'ADMIN' && role !== 'LECTURER' && role !== 'STUDENT') {
    throw new Response('Account role is invalid.', { status: 403 });
  }
  return { identity: { uid: claims.sub, role } as FirestoreIdentity, claims, profile };
}

function decodeFirestoreBearer(request: Request) {
  return request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

function canReadPublication(identity: FirestoreIdentity, publication: Record<string, unknown>) {
  if (identity.role === 'ADMIN') return true;
  if (publication.uploaderId === identity.uid) return true;
  if (publication.status === 'PUBLISHED' && publication.isPrivate !== true) {
    const audiences = Array.isArray(publication.audiences) ? publication.audiences : [];
    if (audiences.includes('GUEST') || (identity.role === 'STUDENT' && audiences.includes('STUDENT'))
      || (identity.role === 'LECTURER' && audiences.includes('LECTURER'))) return true;
  }
  return false;
}

async function canReadPublicationDetails(
  env: Env,
  token: string,
  identity: FirestoreIdentity,
  publicationId: string,
  publication: Record<string, unknown>,
) {
  if (canReadPublication(identity, publication)) return true;
  if (identity.role === 'LECTURER') {
    const reviews = await firestoreQuery(env, token, 'publicationReviews', 'publicationId', publicationId, [
      { field: 'reviewerId', value: identity.uid },
    ]);
    if (reviews.some((review) => review.reviewerId === identity.uid
      && Number(review.round) === Number(publication.reviewRound || 0))) return true;
  }
  return false;
}

const ssoBrowserCorsPaths = new Set(['/oauth/token', '/oauth/userinfo', '/oauth/revoke']);

async function isRegisteredPublicSsoOrigin(origin: string, env: Env): Promise<boolean> {
  if (!origin || !env.DB) return false;
  try {
    const result = await env.DB.prepare("SELECT redirect_uris_json FROM sso_clients WHERE client_type = 'PUBLIC' AND is_active = 1").all<{ redirect_uris_json: string }>();
    return (result.results || []).some((client) => {
      try {
        const redirectUris = JSON.parse(client.redirect_uris_json) as unknown;
        return Array.isArray(redirectUris) && redirectUris.some((redirectUri) => {
          if (typeof redirectUri !== 'string') return false;
          return new URL(redirectUri).origin === origin;
        });
      } catch {
        return false;
      }
    });
  } catch {
    // A missing migration or unavailable D1 binding must never widen browser access.
    return false;
  }
}

export async function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('origin') || '';
  const allow = (env.ALLOWED_ORIGINS || env.FRONTEND_ORIGINS).split(',').map((item) => item.trim()).filter(Boolean);
  const url = new URL(request.url);
  const isConfiguredOrigin = allow.includes(origin);
  const isRegisteredSsoOrigin = !isConfiguredOrigin && ssoBrowserCorsPaths.has(url.pathname)
    && await isRegisteredPublicSsoOrigin(origin, env);
  const headers = new Headers({
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, range, if-range',
    'access-control-expose-headers': 'accept-ranges, content-range, content-length, etag',
    'access-control-max-age': '86400',
    vary: 'Origin',
  });
  if (isConfiguredOrigin || isRegisteredSsoOrigin) headers.set('access-control-allow-origin', origin);
  return headers;
}

async function withCors(response: Response, request: Request, env: Env) {
  const headers = new Headers(response.headers);
  (await corsHeaders(request, env)).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function streamR2Pdf(object: R2ObjectBody, cacheControl: string, fileName: string, isPartialResponse: boolean) {
  const range = isPartialResponse ? object.range : undefined;
  const rangeStart = range?.offset ?? 0;
  const responseLength = range?.length ?? object.size;
  const headers = new Headers({
    'content-type': object.httpMetadata?.contentType || 'application/pdf',
    'content-disposition': `inline; filename="${fileName.replace(/["\\]/g, '') || 'publication.pdf'}"`,
    'cache-control': cacheControl,
    'accept-ranges': 'bytes',
    'content-length': String(responseLength),
  });
  if (range) {
    headers.set('content-range', `bytes ${rangeStart}-${rangeStart + responseLength - 1}/${object.size}`);
  }
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  return new Response(object.body, { status: isPartialResponse ? 206 : 200, headers });
}

async function handleR2Upload(request: Request, env: Env, identity: FirestoreIdentity) {
  if (identity.role === 'ADMIN') {
    // Admins may archive documents, but new submissions belong to an end user.
    throw new Response('Use a student or lecturer account to upload a submission.', { status: 403 });
  }
  const fileName = decodeURIComponent(new URL(request.url).searchParams.get('fileName') || 'submission.pdf');
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!fileName.toLowerCase().endsWith('.pdf') || contentType !== 'application/pdf') {
    throw new Response('Only PDF files are accepted.', { status: 400 });
  }
  if (!request.body || contentLength === 0 || contentLength > maxPdfBytes) {
    throw new Response('The PDF must be non-empty and no larger than 50 MB.', { status: 413 });
  }
  const objectKey = `publications/${new Date().getUTCFullYear()}/${identity.uid}/${crypto.randomUUID()}.pdf`;
  await env.PUBLICATION_PDFS.put(objectKey, request.body, { httpMetadata: { contentType: 'application/pdf' } });
  return json({ success: true, data: { objectKey, fileName, size: contentLength } });
}

async function handleR2Object(request: Request, env: Env, identity: FirestoreIdentity, token: string) {
  const url = new URL(request.url);
  const objectKey = url.searchParams.get('key') || '';
  const publicationId = url.searchParams.get('publicationId') || '';
  if (!objectKey || objectKey.includes('..') || objectKey.startsWith('/')) {
    throw new Response('Invalid object key.', { status: 400 });
  }
  if (request.method === 'DELETE') {
    if (identity.role !== 'ADMIN') {
      if (!publicationId) throw new Response('publicationId is required.', { status: 400 });
      const publication = await firestoreGet(env, token, 'publications', publicationId);
      if (!publication || publication.uploaderId !== identity.uid || publication.status !== 'DRAFTING') {
        throw new Response('Only the owner of a draft publication can delete its files.', { status: 403 });
      }
      const linkedVersion = await firestoreQuery(env, token, 'publicationVersions', 'publicationId', publicationId, [], 1000);
      const belongsToDraft = publication.objectKey === objectKey
        || linkedVersion.some((version) => version.objectKey === objectKey);
      if (!belongsToDraft) throw new Response('File does not belong to this draft publication.', { status: 403 });
    }
    await env.PUBLICATION_PDFS.delete(objectKey);
    return json({ success: true });
  }
  if (request.method !== 'GET') throw new Response('Method not allowed.', { status: 405 });
  if (!publicationId) throw new Response('publicationId is required.', { status: 400 });
  const publication = await firestoreGet(env, token, 'publications', publicationId);
  if (!publication || !await canReadPublicationDetails(env, token, identity, publicationId, publication)) {
    throw new Response('You cannot read this publication file.', { status: 403 });
  }
  let belongsToPublication = publication.objectKey === objectKey;
  if (!belongsToPublication) {
    const currentVersionId = typeof publication.currentVersionId === 'string' ? publication.currentVersionId : '';
    if (currentVersionId) {
      const currentVersion = await firestoreGet(env, token, 'publicationVersions', currentVersionId);
      belongsToPublication = currentVersion?.objectKey === objectKey;
    }
  }
  if (!belongsToPublication) {
    const versions = await firestoreQuery(env, token, 'publicationVersions', 'publicationId', publicationId, [], 1000);
    belongsToPublication = versions.some((version) => version.objectKey === objectKey);
  }
  if (!belongsToPublication) throw new Response('File does not belong to this publication.', { status: 403 });
  const object = request.headers.has('range')
    ? await env.PUBLICATION_PDFS.get(objectKey, { range: request.headers })
    : await env.PUBLICATION_PDFS.get(objectKey);
  if (!object) throw new Response('File not found.', { status: 404 });
  return streamR2Pdf(object, 'private, no-store', objectKey.split('/').pop() || 'publication.pdf', request.headers.has('range'));
}

async function publicObjectBelongsToPublication(env: Env, publicationId: string, publication: Record<string, unknown>, objectKey: string) {
  if (publication.objectKey === objectKey) return true;
  const currentVersionId = typeof publication.currentVersionId === 'string' ? publication.currentVersionId : '';
  if (currentVersionId) {
    const currentVersion = await firestoreGet(env, undefined, 'publicationVersions', currentVersionId);
    if (currentVersion?.objectKey === objectKey) return true;
  }
  const versions = await firestoreQuery(env, undefined, 'publicationVersions', 'publicationId', publicationId, [], 1000);
  return versions.some((version) => version.objectKey === objectKey);
}

async function handlePublicR2Object(request: Request, env: Env) {
  const url = new URL(request.url);
  const objectKey = url.searchParams.get('key') || '';
  const publicationId = url.searchParams.get('publicationId') || '';
  if (!objectKey || !publicationId || objectKey.includes('..') || objectKey.startsWith('/')) {
    throw new Response('Invalid public file request.', { status: 400 });
  }
  const publication = await firestoreGet(env, undefined, 'publications', publicationId);
  const audiences = Array.isArray(publication?.audiences) ? publication.audiences : [];
  if (!publication || publication.status !== 'PUBLISHED' || publication.isPrivate === true || !audiences.includes('GUEST')) {
    throw new Response('This publication is not publicly available.', { status: 403 });
  }
  if (!await publicObjectBelongsToPublication(env, publicationId, publication, objectKey)) {
    throw new Response('File does not belong to this publication.', { status: 403 });
  }
  const object = request.headers.has('range')
    ? await env.PUBLICATION_PDFS.get(objectKey, { range: request.headers })
    : await env.PUBLICATION_PDFS.get(objectKey);
  if (!object) throw new Response('File not found.', { status: 404 });
  return streamR2Pdf(object, 'public, max-age=300', objectKey.split('/').pop() || 'publication.pdf', request.headers.has('range'));
}

async function handleGrobid(request: Request, env: Env) {
  if (!request.body) throw new Response('Missing PDF request body.', { status: 400 });
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    throw new Response('Expected a multipart PDF upload.', { status: 400 });
  }
  const target = new URL(grobidPath, env.GROBID_ORIGIN);
  const upstream = await env.PRIVATE_NETWORK.fetch(target, {
    method: 'POST',
    headers: { 'content-type': contentType, accept: request.headers.get('accept') || 'application/xml' },
    body: request.body,
  });
  const headers = new Headers({ 'cache-control': 'no-store' });
  const upstreamContentType = upstream.headers.get('content-type');
  if (upstreamContentType) headers.set('content-type', upstreamContentType);
  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: await corsHeaders(request, env) });
    if (url.pathname === '/health' && request.method === 'GET') {
      return withCors(json({ ok: true, service: 'rpr-data-worker' }), request, env);
    }

    try {
      if (url.pathname.startsWith('/oauth/')) {
        const workspaceResponse = await handleWorkspaceRequest(request, env as import('./workspace/types').WorkspaceEnv);
        if (workspaceResponse) return withCors(workspaceResponse, request, env);
      }
      if (url.pathname === '/auth/username-login' && request.method === 'POST') {
        const workspaceResponse = await handleWorkspaceRequest(request, env as import('./workspace/types').WorkspaceEnv);
        if (workspaceResponse) return withCors(workspaceResponse, request, env);
      }
      if (url.pathname === '/auth/workspace/exchange' && request.method === 'POST') {
        const token = decodeFirestoreBearer(request);
        let claims: FirebaseClaims;
        try { claims = await verifyFirebaseToken(request, env); }
        catch (error) {
          const status = error instanceof Response ? error.status : 401;
          return withCors(json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in with Google Workspace first.', details: null } }, status), request, env);
        }
        const workspaceResponse = await handleWorkspaceRequest(request, env as import('./workspace/types').WorkspaceEnv, {
          uid: claims.sub, role: 'STUDENT', email: claims.email, emailVerified: claims.email_verified === true,
          signInProvider: claims.firebase?.sign_in_provider,
        }, token);
        if (workspaceResponse) return withCors(workspaceResponse, request, env);
      }
      if (url.pathname.startsWith('/auth/google/') || url.pathname.startsWith('/auth/workspace/') || url.pathname.startsWith('/api/workspace/') || url.pathname.startsWith('/api/sso/') || url.pathname.startsWith('/api/research-projects')) {
        if (url.pathname === '/auth/google/callback' && request.method === 'GET') {
          const workspaceResponse = await handleWorkspaceRequest(request, env as import('./workspace/types').WorkspaceEnv);
          if (workspaceResponse) return withCors(workspaceResponse, request, env);
        }
        const token = decodeFirestoreBearer(request);
        let identity: FirestoreIdentity;
        let claims: FirebaseClaims;
        try {
          ({ identity, claims } = await requireIdentity(request, env, token));
        } catch (error) {
          const status = error instanceof Response ? error.status : 503;
          const code = status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'WORKSPACE_PERMISSION_DENIED' : 'IDENTITY_PROVIDER_UNAVAILABLE';
          const isSsoEndpoint = url.pathname.startsWith('/api/sso/');
          const message = status === 401 ? 'Firebase authentication is required.'
            : status === 403 ? (isSsoEndpoint ? 'An approved active application profile is required.' : 'An active administrator account is required.')
              : 'Could not validate the application identity.';
          return withCors(json({ success: false, error: { code, message, details: null } }, status), request, env);
        }
        const workspaceResponse = await handleWorkspaceRequest(request, env as import('./workspace/types').WorkspaceEnv, {
          ...identity, email: claims.email, emailVerified: claims.email_verified === true,
          signInProvider: claims.firebase?.sign_in_provider,
        }, token);
        if (workspaceResponse) return withCors(workspaceResponse, request, env);
      }
      if (url.pathname === '/auth/register' && request.method === 'POST') {
        return withCors(await registerAccount(request, env), request, env);
      }
      const token = decodeFirestoreBearer(request);
      if (url.pathname === '/r2/object' && request.method === 'GET' && !token) {
        return withCors(await handlePublicR2Object(request, env), request, env);
      }
      const { identity } = await requireIdentity(request, env, token);
      let response: Response;
      if (url.pathname === '/auth/invite' && request.method === 'POST') {
        response = await sendAccountSetupLink(request, env, identity, token);
      } else if (url.pathname === '/r2/upload' && request.method === 'POST') {
        response = await handleR2Upload(request, env, identity);
      } else if (url.pathname === '/r2/object') {
        response = await handleR2Object(request, env, identity, token);
      } else if (url.pathname === grobidPath && request.method === 'POST') {
        response = await handleGrobid(request, env);
      } else {
        response = new Response('Not Found', { status: 404 });
      }
      return withCors(response, request, env);
    } catch (error) {
      if (error instanceof Response) return withCors(error, request, env);
      console.error('ResearchPulse Worker request failed', error);
      return withCors(json({ message: 'The request could not be completed.' }, 502), request, env);
    }
  },
};

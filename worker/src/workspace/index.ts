import { createFirebaseCustomToken, createFirebaseServiceAccessToken, createPkceChallenge, decryptSecret, encryptSecret, randomToken, sha256, verifyGoogleIdentityToken } from './crypto';
import { ApiError, type WorkspaceEnv, type WorkspaceIdentity, type WorkspaceUser } from './types';

const connectionId = 'primary';
const DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/admin.directory.user';
const allowedUpdateFields = ['givenName', 'familyName', 'orgUnitPath', 'recoveryEmail', 'recoveryPhone'] as const;
type Permission = 'workspace.read' | 'workspace.create' | 'workspace.update' | 'workspace.suspend' | 'workspace.delete' | 'workspace.oauth.manage' | 'appUser.delete';

function response(data: unknown, message = 'Operation completed successfully', status = 200) {
  return Response.json({ success: true, data, message }, { status, headers: { 'cache-control': 'no-store' } });
}

function errorResponse(error: unknown) {
  const known = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
  return Response.json({ success: false, error: { code: known.code, message: known.message, details: known.details } }, {
    status: known.status, headers: { 'cache-control': 'no-store' },
  });
}

function jsonError(status: number, code: string, message: string, details: unknown = null): never {
  throw new ApiError(status, code, message, details);
}

function hasPermission(identity: WorkspaceIdentity, permission: Permission, env: WorkspaceEnv): boolean {
  if (identity.role !== 'ADMIN') return false;
  if (permission === 'workspace.delete') return env.WORKSPACE_DELETE_ENABLED === 'true';
  return true;
}

async function authorize(identity: WorkspaceIdentity, permission: Permission, env: WorkspaceEnv) {
  if (hasPermission(identity, permission, env)) return;
  await audit(env, identity.uid, 'WORKSPACE_OPERATION_DENIED', 'DENIED', null, permission);
  jsonError(403, 'WORKSPACE_PERMISSION_DENIED', 'Insufficient permission.');
}

async function audit(env: WorkspaceEnv, actorUid: string, action: string, outcome: string, targetId: string | null, detail: string | null = null) {
  try {
    await env.DB.prepare('INSERT INTO workspace_audit_logs (actor_uid, action, occurred_at, outcome, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(actorUid, action, new Date().toISOString(), outcome, targetId, detail).run();
  } catch (error) {
    console.error('Workspace audit write failed', error instanceof Error ? error.message : 'unknown');
  }
}

async function rateLimit(env: WorkspaceEnv, uid: string, operation: string, max = 30, windowSeconds = 600) {
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSeconds) * windowSeconds;
  await env.DB.prepare('INSERT INTO workspace_rate_limits (actor_uid, operation, window_start, request_count) VALUES (?, ?, ?, 1) ON CONFLICT(actor_uid, operation, window_start) DO UPDATE SET request_count = request_count + 1')
    .bind(uid, operation, bucket).run();
  const row = await env.DB.prepare('SELECT request_count FROM workspace_rate_limits WHERE actor_uid = ? AND operation = ? AND window_start = ?')
    .bind(uid, operation, bucket).first<{ request_count: number }>();
  if ((row?.request_count || 0) > max) jsonError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests. Try again later.');
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM workspace_rate_limits WHERE window_start < ?').bind(now - 86400).run();
}

function configuredDomain(env: WorkspaceEnv) {
  const domain = env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase();
  if (!domain || domain.includes('@') || domain.includes('/') || !domain.includes('.')) {
    jsonError(503, 'WORKSPACE_NOT_CONFIGURED', 'The Google Workspace domain is not configured.');
  }
  return domain;
}

function allowedAdminEmails(env: WorkspaceEnv): Set<string> {
  return new Set((env.GOOGLE_ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
}

function assertGoogleAdmin(email: string, hostedDomain: string, env: WorkspaceEnv) {
  const domain = configuredDomain(env);
  if (email.split('@')[1] !== domain || hostedDomain !== domain || !allowedAdminEmails(env).has(email)) {
    jsonError(403, 'GOOGLE_ADMIN_NOT_ALLOWED', 'The Google account is not an approved Workspace administrator.');
  }
}

function frontendRedirect(env: WorkspaceEnv, outcome: string) {
  const target = new URL('/admin/users', env.FRONTEND_URL);
  const allowed = (env.ALLOWED_ORIGINS || env.FRONTEND_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(target.origin)) jsonError(503, 'FRONTEND_NOT_CONFIGURED', 'The frontend redirect origin is not allowlisted.');
  target.searchParams.set('workspace_connection', outcome);
  return Response.redirect(target.toString(), 302);
}

interface ConnectionRow {
  id: string;
  workspace_domain: string;
  admin_email: string;
  admin_subject: string;
  connected_by_uid: string;
  refresh_token_ciphertext: string | null;
  refresh_token_nonce: string | null;
  token_key_version: string | null;
  granted_scopes: string;
  status: 'CONNECTED' | 'REVOKED' | 'DISCONNECTED';
  connected_at: string;
  updated_at: string;
}

export async function consumeOAuthTransaction(env: WorkspaceEnv, id: string, state: string, now = new Date().toISOString()) {
  const transaction = await env.DB.prepare('SELECT * FROM oauth_transactions WHERE id = ? AND state_hash = ? AND expires_at > ? AND consumed_at IS NULL')
    .bind(id, await sha256(state), now).first<{
      id: string; nonce: string; pkce_ciphertext: string; pkce_nonce: string; token_key_version: string; actor_uid: string;
    }>();
  if (!transaction) return null;
  const consumed = await env.DB.prepare('UPDATE oauth_transactions SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
    .bind(now, transaction.id).run();
  return consumed.meta?.changes === 1 ? transaction : null;
}

async function getConnection(env: WorkspaceEnv) {
  return env.DB.prepare('SELECT * FROM google_oauth_connections WHERE id = ?').bind(connectionId).first<ConnectionRow>();
}

function cipherFromConnection(row: ConnectionRow) {
  if (!row.refresh_token_ciphertext || !row.refresh_token_nonce || !row.token_key_version) return null;
  return { ciphertext: row.refresh_token_ciphertext, nonce: row.refresh_token_nonce, keyVersion: row.token_key_version };
}

async function startOAuth(request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'workspace.oauth.manage', env);
  await rateLimit(env, identity.uid, 'oauth-start', 8, 3600);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    jsonError(503, 'WORKSPACE_NOT_CONFIGURED', 'Google OAuth is not configured on this Worker.');
  }
  const frontend = new URL(env.FRONTEND_URL);
  const allowedOrigins = (env.ALLOWED_ORIGINS || env.FRONTEND_ORIGINS || '').split(',').map((value) => value.trim());
  if (!allowedOrigins.includes(frontend.origin)) jsonError(503, 'FRONTEND_NOT_CONFIGURED', 'The frontend origin is not allowlisted.');
  const existing = await getConnection(env);
  if (existing?.status === 'CONNECTED') {
    const admins = allowedAdminEmails(env);
    if (!admins.has(existing.admin_email)) jsonError(409, 'OAUTH_CONNECTION_PROTECTED', 'Disconnect the current Workspace connection before replacing it.');
  }
  const transactionId = crypto.randomUUID();
  const state = randomToken(32);
  const nonce = randomToken(32);
  const verifier = randomToken(48);
  const encryptedVerifier = await encryptSecret(env, verifier, `oauth-transaction:${transactionId}`);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare('DELETE FROM oauth_transactions WHERE expires_at <= ? OR consumed_at IS NOT NULL').bind(new Date().toISOString()).run();
  await env.DB.prepare('INSERT INTO oauth_transactions (id, state_hash, nonce, pkce_ciphertext, pkce_nonce, token_key_version, actor_uid, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
    .bind(transactionId, await sha256(state), nonce, encryptedVerifier.ciphertext, encryptedVerifier.nonce, encryptedVerifier.keyVersion, identity.uid, expiresAt, new Date().toISOString()).run();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', `openid email profile ${DIRECTORY_SCOPE}`);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('state', `${transactionId}.${state}`);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', await createPkceChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return response({ authorizationUrl: url.toString() }, 'Google authorization URL created.');
}

async function callback(request: Request, env: WorkspaceEnv) {
  const url = new URL(request.url);
  if (url.searchParams.has('error')) return frontendRedirect(env, 'failed');
  const stateValue = url.searchParams.get('state') || '';
  const [transactionId, state, extra] = stateValue.split('.');
  const code = url.searchParams.get('code') || '';
  if (!transactionId || !state || extra || !code) return frontendRedirect(env, 'failed');
  const now = new Date().toISOString();
  const transaction = await consumeOAuthTransaction(env, transactionId, state, now);
  if (!transaction) return frontendRedirect(env, 'failed');
  const verifier = await decryptSecret(env, {
    ciphertext: transaction.pkce_ciphertext, nonce: transaction.pkce_nonce, keyVersion: transaction.token_key_version,
  }, `oauth-transaction:${transaction.id}`);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(12000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const tokens = await tokenResponse.json().catch(() => null) as {
    access_token?: string; refresh_token?: string; id_token?: string; scope?: string; error?: string; expires_in?: number;
  } | null;
  if (!tokenResponse.ok || !tokens?.access_token || !tokens.id_token) return frontendRedirect(env, 'failed');
  const googleIdentity = await verifyGoogleIdentityToken(tokens.id_token, env, transaction.nonce);
  assertGoogleAdmin(googleIdentity.email, googleIdentity.hostedDomain, env);
  const existing = await getConnection(env);
  if (existing?.status === 'CONNECTED' && existing.admin_email !== googleIdentity.email) {
    await audit(env, transaction.actor_uid, 'WORKSPACE_OPERATION_DENIED', 'DENIED', googleIdentity.email, 'oauth-connection-replacement');
    return frontendRedirect(env, 'protected');
  }
  let refreshToken = tokens.refresh_token;
  if (!refreshToken && existing?.status === 'CONNECTED' && existing.admin_email === googleIdentity.email) {
    const existingCipher = cipherFromConnection(existing);
    if (existingCipher) refreshToken = await decryptSecret(env, existingCipher, `workspace-refresh:${connectionId}:${existing.admin_email}`);
  }
  if (!refreshToken) return frontendRedirect(env, 'missing_refresh_token');
  const encrypted = await encryptSecret(env, refreshToken, `workspace-refresh:${connectionId}:${googleIdentity.email}`);
  const scopes = (tokens.scope || '').split(/\s+/).filter(Boolean);
  if (!scopes.includes(DIRECTORY_SCOPE)) return frontendRedirect(env, 'scope_missing');
  await env.DB.prepare(`INSERT INTO google_oauth_connections
      (id, workspace_domain, admin_email, admin_subject, connected_by_uid, refresh_token_ciphertext, refresh_token_nonce, token_key_version, granted_scopes, status, connected_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONNECTED', ?, ?)
      ON CONFLICT(id) DO UPDATE SET workspace_domain=excluded.workspace_domain, admin_email=excluded.admin_email, admin_subject=excluded.admin_subject,
      connected_by_uid=excluded.connected_by_uid,
      refresh_token_ciphertext=excluded.refresh_token_ciphertext, refresh_token_nonce=excluded.refresh_token_nonce,
      token_key_version=excluded.token_key_version, granted_scopes=excluded.granted_scopes, status='CONNECTED', updated_at=excluded.updated_at`)
    .bind(connectionId, configuredDomain(env), googleIdentity.email, googleIdentity.subject, transaction.actor_uid, encrypted.ciphertext, encrypted.nonce,
      encrypted.keyVersion, JSON.stringify(scopes), existing?.connected_at || now, now).run();
  await audit(env, transaction.actor_uid, 'GOOGLE_OAUTH_CONNECTED', 'SUCCESS', googleIdentity.email);
  return frontendRedirect(env, 'connected');
}

async function connectionStatus(env: WorkspaceEnv) {
  const connection = await getConnection(env);
  return response({ connected: connection?.status === 'CONNECTED', status: connection?.status || 'DISCONNECTED',
    domain: connection?.workspace_domain || null, adminEmail: connection?.admin_email || null,
    connectedAt: connection?.connected_at || null, scopes: connection ? JSON.parse(connection.granted_scopes) as string[] : [],
    deleteEnabled: env.WORKSPACE_DELETE_ENABLED === 'true' });
}

async function disconnect(env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'workspace.oauth.manage', env);
  await rateLimit(env, identity.uid, 'oauth-disconnect', 5, 3600);
  const connection = await getConnection(env);
  if (!connection || connection.status !== 'CONNECTED') return response({ connected: false, status: 'DISCONNECTED' }, 'Workspace is already disconnected.');
  const cipher = cipherFromConnection(connection);
  if (cipher) {
    const refreshToken = await decryptSecret(env, cipher, `workspace-refresh:${connectionId}:${connection.admin_email}`);
    try {
      await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken }) });
    } catch { /* Still erase local credentials when the upstream revoke endpoint is unreachable. */ }
  }
  await env.DB.prepare("UPDATE google_oauth_connections SET refresh_token_ciphertext = NULL, refresh_token_nonce = NULL, token_key_version = NULL, status = 'DISCONNECTED', updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), connectionId).run();
  await audit(env, identity.uid, 'GOOGLE_OAUTH_DISCONNECTED', 'SUCCESS', connection.admin_email);
  return response({ connected: false, status: 'DISCONNECTED' }, 'Workspace disconnected.');
}

async function accessToken(env: WorkspaceEnv): Promise<{ token: string; connection: ConnectionRow }> {
  const connection = await getConnection(env);
  const cipher = connection && cipherFromConnection(connection);
  if (!connection || connection.status !== 'CONNECTED' || !cipher) jsonError(503, 'WORKSPACE_CONNECTION_UNAVAILABLE', 'Google Workspace is not connected.');
  const refreshToken = await decryptSecret(env, cipher, `workspace-refresh:${connectionId}:${connection.admin_email}`);
  if (cipher.keyVersion !== env.TOKEN_ENCRYPTION_KEY_VERSION) {
    const rotated = await encryptSecret(env, refreshToken, `workspace-refresh:${connectionId}:${connection.admin_email}`);
    await env.DB.prepare('UPDATE google_oauth_connections SET refresh_token_ciphertext=?, refresh_token_nonce=?, token_key_version=?, updated_at=? WHERE id=?')
      .bind(rotated.ciphertext, rotated.nonce, rotated.keyVersion, new Date().toISOString(), connectionId).run();
  }
  const result = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(12000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const body = await result.json().catch(() => null) as { access_token?: string; error?: string } | null;
  if (!result.ok || !body?.access_token) {
    if (body?.error === 'invalid_grant') {
      await env.DB.prepare("UPDATE google_oauth_connections SET status='REVOKED', refresh_token_ciphertext=NULL, refresh_token_nonce=NULL, token_key_version=NULL, updated_at=? WHERE id=?")
        .bind(new Date().toISOString(), connectionId).run();
      await audit(env, connection.connected_by_uid || 'system', 'GOOGLE_OAUTH_REFRESH_FAILED', 'REVOKED', connection.admin_email);
      jsonError(503, 'WORKSPACE_CONNECTION_REVOKED', 'Google Workspace authorization was revoked. Reconnect the administrator account.');
    }
    await audit(env, connection.connected_by_uid || 'system', 'GOOGLE_OAUTH_REFRESH_FAILED', 'FAILED', connection.admin_email);
    jsonError(503, 'WORKSPACE_CONNECTION_UNAVAILABLE', 'Could not refresh Google Workspace authorization.');
  }
  return { token: body.access_token, connection };
}

async function googleApi<T>(env: WorkspaceEnv, path: string, init: RequestInit = {}, allowRetry = false): Promise<T> {
  const { token, connection } = await accessToken(env);
  const perform = (bearer: string) => {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body) headers.set('content-type', 'application/json');
    headers.set('authorization', `Bearer ${bearer}`);
    return fetch(`https://admin.googleapis.com/admin/directory/v1${path}`, { ...init, signal: AbortSignal.timeout(15000), headers });
  };
  let result = await perform(token);
  if (result.status === 401) {
    if (allowRetry) {
      const refreshed = await accessToken(env);
      result = await perform(refreshed.token);
    }
    if (result.status === 401) {
      await env.DB.prepare("UPDATE google_oauth_connections SET status='REVOKED', refresh_token_ciphertext=NULL, refresh_token_nonce=NULL, token_key_version=NULL, updated_at=? WHERE id=?")
        .bind(new Date().toISOString(), connectionId).run();
      await audit(env, connection.connected_by_uid || 'system', 'GOOGLE_OAUTH_REFRESH_FAILED', 'UNAUTHORIZED', connection.admin_email);
      jsonError(503, 'WORKSPACE_CONNECTION_REVOKED', 'Google Workspace authorization is no longer valid. Reconnect the administrator account.');
    }
  }
  if (allowRetry && (result.status === 429 || result.status >= 500)) {
    for (const delay of [200, 600]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      result = await perform(token);
      if (result.status !== 429 && result.status < 500) break;
    }
  }
  const payload = await result.json().catch(() => null) as { error?: { message?: string; errors?: Array<{ reason?: string }> } } | null;
  if (!result.ok) {
    const reason = payload?.error?.errors?.[0]?.reason;
    const message = payload?.error?.message || 'Google Workspace request failed.';
    if (result.status === 404) jsonError(404, 'WORKSPACE_USER_NOT_FOUND', 'Workspace user was not found.');
    if (result.status === 409 || reason === 'duplicate') jsonError(409, 'WORKSPACE_USER_EXISTS', 'A Workspace user with this email already exists.');
    if (result.status === 429) jsonError(429, 'WORKSPACE_RATE_LIMITED', 'Google Workspace rate limit reached. Try again shortly.');
    if (result.status === 403) jsonError(403, 'WORKSPACE_GOOGLE_PERMISSION_DENIED', 'The connected administrator lacks permission for this operation.');
    if (result.status >= 500 || result.status === 401) jsonError(502, 'GOOGLE_API_ERROR', 'Google Workspace is temporarily unavailable.');
    jsonError(400, 'GOOGLE_API_ERROR', message.slice(0, 240));
  }
  return (payload || {}) as T;
}

function normalizeUser(user: Record<string, unknown>): WorkspaceUser {
  const name = (user.name && typeof user.name === 'object' ? user.name : {}) as Record<string, unknown>;
  return {
    id: String(user.id || ''), primaryEmail: String(user.primaryEmail || ''),
    name: { givenName: String(name.givenName || ''), familyName: String(name.familyName || ''), fullName: String(name.fullName || '') },
    suspended: user.suspended === true, ...(typeof user.orgUnitPath === 'string' ? { orgUnitPath: user.orgUnitPath } : {}),
    ...(typeof user.recoveryEmail === 'string' ? { recoveryEmail: user.recoveryEmail } : {}),
    ...(typeof user.recoveryPhone === 'string' ? { recoveryPhone: user.recoveryPhone } : {}),
    ...(typeof user.creationTime === 'string' ? { creationTime: user.creationTime } : {}),
    ...(typeof user.lastLoginTime === 'string' ? { lastLoginTime: user.lastLoginTime } : {}),
    ...(typeof user.changePasswordAtNextLogin === 'boolean' ? { changePasswordAtNextLogin: user.changePasswordAtNextLogin } : {}),
  };
}

function validateEmail(email: unknown, env: WorkspaceEnv) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) jsonError(400, 'VALIDATION_ERROR', 'A valid Workspace email is required.');
  const normalized = email.trim().toLowerCase();
  if (normalized.split('@')[1] !== configuredDomain(env)) jsonError(400, 'WORKSPACE_DOMAIN_RESTRICTED', 'The email must use the configured Workspace domain.');
  return normalized;
}

function temporaryPassword() {
  const classes = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%_-'];
  const alphabet = classes.join('');
  const randomIndex = (length: number) => {
    const ceiling = Math.floor(256 / length) * length;
    while (true) {
      const byte = crypto.getRandomValues(new Uint8Array(1))[0];
      if (byte < ceiling) return byte % length;
    }
  };
  const pick = (characters: string) => characters[randomIndex(characters.length)];
  const output = classes.map(pick);
  while (output.length < 28) output.push(pick(alphabet));
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output.join('');
}

function parseJson(request: Request) {
  return request.json().catch(() => jsonError(400, 'VALIDATION_ERROR', 'Request body must be valid JSON.')) as Promise<Record<string, unknown>>;
}

async function listUsers(request: Request, env: WorkspaceEnv) {
  const url = new URL(request.url);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || 50)));
  if (!Number.isInteger(pageSize)) jsonError(400, 'VALIDATION_ERROR', 'pageSize must be between 1 and 100.');
  const pageToken = url.searchParams.get('pageToken') || '';
  if (pageToken.length > 2048) jsonError(400, 'VALIDATION_ERROR', 'pageToken is too long.');
  const orderBy = url.searchParams.get('orderBy') || 'email';
  if (!['email', 'givenName', 'familyName'].includes(orderBy)) jsonError(400, 'VALIDATION_ERROR', 'Unsupported orderBy value.');
  const sortOrder = url.searchParams.get('sortOrder') || 'ASCENDING';
  if (!['ASCENDING', 'DESCENDING'].includes(sortOrder)) jsonError(400, 'VALIDATION_ERROR', 'sortOrder must be ASCENDING or DESCENDING.');
  const query = url.searchParams.get('query')?.trim() || '';
  if (query.length > 200) jsonError(400, 'VALIDATION_ERROR', 'query is too long.');
  const params = new URLSearchParams({ domain: configuredDomain(env), maxResults: String(pageSize), orderBy, sortOrder });
  if (pageToken) params.set('pageToken', pageToken);
  if (query) params.set('query', query);
  const result = await googleApi<{ users?: Record<string, unknown>[]; nextPageToken?: string; etag?: string }>(env, `/users?${params}`, {}, true);
  return response({ users: (result.users || []).map(normalizeUser).filter((user) => user.primaryEmail.toLowerCase().endsWith(`@${configuredDomain(env)}`)), nextPageToken: result.nextPageToken || null, pageSize,
    total: null, etag: result.etag || null });
}

async function getUser(id: string, env: WorkspaceEnv) {
  if (!id || id.length > 254 || /[/?#]/.test(id)) jsonError(400, 'VALIDATION_ERROR', 'Invalid Workspace user identifier.');
  const result = await googleApi<Record<string, unknown>>(env, `/users/${encodeURIComponent(id)}`, {}, true);
  const user = normalizeUser(result);
  validateEmail(user.primaryEmail, env);
  return response(user);
}

async function createUser(request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'workspace.create', env);
  await rateLimit(env, identity.uid, 'user-create', 15, 600);
  const input = await parseJson(request);
  const primaryEmail = validateEmail(input.email, env);
  const firstName = typeof input.firstName === 'string' ? input.firstName.trim() : '';
  const lastName = typeof input.lastName === 'string' ? input.lastName.trim() : '';
  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) jsonError(400, 'VALIDATION_ERROR', 'firstName and lastName are required and must be at most 100 characters.');
  if (typeof input.password === 'string' && input.password) jsonError(400, 'PASSWORD_MUST_BE_GENERATED', 'The Worker generates a unique temporary password for each mailbox. Do not submit or reuse a shared password.');
  const password = temporaryPassword();
  const orgUnitPath = typeof input.orgUnitPath === 'string' ? input.orgUnitPath.trim() : '/';
  if (!orgUnitPath.startsWith('/') || orgUnitPath.length > 256) jsonError(400, 'VALIDATION_ERROR', 'orgUnitPath must be an absolute organizational-unit path.');

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const encryptedPassword = await encryptSecret(env, password, `workspace-temp-password:${primaryEmail}`);
  await env.DB.prepare('DELETE FROM workspace_temp_credentials WHERE expires_at <= ?').bind(createdAt.toISOString()).run();
  const existingCredential = await env.DB.prepare('SELECT workspace_email FROM workspace_temp_credentials WHERE workspace_email = ?')
    .bind(primaryEmail).first<{ workspace_email: string }>();
  if (existingCredential) jsonError(409, 'WORKSPACE_CREDENTIAL_ALREADY_STAGED', 'A temporary credential is already staged for this mailbox. Link it to its application profile or wait for it to expire before recreating the account.');
  try {
    await env.DB.prepare(`INSERT INTO workspace_temp_credentials
      (workspace_email, ciphertext, nonce, key_version, status, created_by_uid, created_at, expires_at)
      VALUES (?, ?, ?, ?, 'READY', ?, ?, ?)`)
      .bind(primaryEmail, encryptedPassword.ciphertext, encryptedPassword.nonce, encryptedPassword.keyVersion, identity.uid, createdAt.toISOString(), expiresAt).run();
  } catch {
    jsonError(503, 'TEMPORARY_CREDENTIAL_STORAGE_FAILED', 'The Worker could not safely stage a temporary credential. No Workspace mailbox was created.');
  }

  let user: Record<string, unknown>;
  try {
    user = await googleApi<Record<string, unknown>>(env, '/users', { method: 'POST', body: JSON.stringify({
      primaryEmail, name: { givenName: firstName, familyName: lastName }, password,
      changePasswordAtNextLogin: input.changePasswordAtNextLogin !== false, orgUnitPath,
    }) });
  } catch (error) {
    await env.DB.prepare('DELETE FROM workspace_temp_credentials WHERE workspace_email = ? AND created_by_uid = ? AND created_at = ?')
      .bind(primaryEmail, identity.uid, createdAt.toISOString()).run();
    await audit(env, identity.uid, 'WORKSPACE_USER_CREATED', 'FAILED', primaryEmail, error instanceof ApiError ? error.code : null);
    throw error;
  }
  await audit(env, identity.uid, 'WORKSPACE_USER_CREATED', 'SUCCESS', String(user.id || primaryEmail), primaryEmail);
  return response(normalizeUser(user), 'Workspace user created.', 201);
}

async function stagedTemporaryPassword(env: WorkspaceEnv, workspaceEmail: string) {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`SELECT ciphertext, nonce, key_version, expires_at
    FROM workspace_temp_credentials WHERE workspace_email = ? AND status = 'READY'`)
    .bind(workspaceEmail).first<{ ciphertext: string; nonce: string; key_version: string; expires_at: string }>();
  if (!row) return null;
  if (row.expires_at <= now) {
    await env.DB.prepare('DELETE FROM workspace_temp_credentials WHERE workspace_email = ?').bind(workspaceEmail).run();
    return null;
  }
  const password = await decryptSecret(env, { ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.key_version }, `workspace-temp-password:${workspaceEmail}`);
  return { password };
}

async function discardStagedTemporaryPassword(env: WorkspaceEnv, workspaceEmail: string) {
  await env.DB.prepare('DELETE FROM workspace_temp_credentials WHERE workspace_email = ?').bind(workspaceEmail).run();
}

function normalizeUsername(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function appUserPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*';
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function firebasePasswordRequest(env: WorkspaceEnv, body: Record<string, unknown>, endpoint: 'signUp' | 'signInWithPassword') {
  if (!env.FIREBASE_WEB_API_KEY) jsonError(503, 'FIREBASE_AUTH_NOT_CONFIGURED', 'Firebase password sign-in is not configured on the Worker.');
  const result = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const payload = await result.json().catch(() => null) as { localId?: string; error?: { message?: string } } | null;
  return { result, payload };
}

async function sendAppUserCredentials(env: WorkspaceEnv, to: string, name: string, username: string, password: string) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) throw new Error('Credential email delivery is not configured.');
  const safe = (value: string) => htmlEscape(value);
  const loginUrl = frontendLoginUrl(env);
  const loginText = loginUrl ? `\nSign in: ${loginUrl}` : '';
  const text = `Hello ${name || 'there'},\n\nYour HyperDataLab account is ready.\nUsername: ${username}\nTemporary password: ${password}\n\nSign in with username and password.${loginText}\nPlease change your password after signing in.`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033"><h2>Your HyperDataLab account is ready</h2><p>Hello ${safe(name || 'there')},</p><p>Sign in with these details:</p><p><b>Username:</b> ${safe(username)}<br><b>Temporary password:</b> <code>${safe(password)}</code></p>${loginUrl ? `<p><a href="${safe(loginUrl)}">Open HyperDataLab</a></p>` : ''}<p>Please change your password after signing in.</p></body></html>`;
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [to], subject: 'HyperDataLab | Your sign-in details', text, html }),
  });
  if (!result.ok) throw new Error('Credential email delivery failed.');
}

async function createApplicationUser(request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'workspace.create', env);
  await rateLimit(env, identity.uid, 'app-user-create', 15, 600);
  const input = await parseJson(request);
  const username = normalizeUsername(input.username);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) jsonError(400, 'INVALID_USERNAME', 'Username must be 3 to 32 characters and use letters, numbers, dots, underscores, or hyphens.');
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) jsonError(400, 'INVALID_EMAIL', 'Enter a valid contact email.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 160) jsonError(400, 'VALIDATION_ERROR', 'Name is required and must be at most 160 characters.');
  const role = input.role;
  if (role !== 'ADMIN' && role !== 'LECTURER' && role !== 'STUDENT') jsonError(400, 'VALIDATION_ERROR', 'Choose a supported application role.');
  const studentId = typeof input.studentId === 'string' ? input.studentId.trim() : '';
  const major = typeof input.major === 'string' ? input.major.trim() : '';
  if (studentId.length > 50 || major.length > 120) jsonError(400, 'VALIDATION_ERROR', 'Student ID or major exceeds the allowed length.');
  const passwordMode = input.passwordMode === 'CUSTOM' ? 'CUSTOM' : 'GENERATE';
  const password = passwordMode === 'CUSTOM' ? (typeof input.password === 'string' ? input.password : '') : appUserPassword();
  if (password.length < 8 || password.length > 128) jsonError(400, 'INVALID_PASSWORD', 'Password must be between 8 and 128 characters.');
  const now = new Date().toISOString();
  let uid = crypto.randomUUID();
  const reservationUid = uid;
  const expiry = new Date(Date.now() + 7 * 86400000).toISOString();
  try {
    await env.DB.prepare(`INSERT INTO app_user_logins (profile_uid, username, email, status, created_at, updated_at)
      VALUES (?, ?, ?, 'PROVISIONING', ?, ?)`).bind(uid, username, email, now, now).run();
  } catch (error) {
    const storageError = error instanceof Error ? error.message : String(error);
    if (/unique constraint failed/i.test(storageError)) {
      jsonError(409, 'USERNAME_OR_EMAIL_ALREADY_EXISTS', 'Username or email is already assigned to an account.');
    }
    console.error('App user login reservation failed', storageError);
    jsonError(503, 'APP_USER_LOGIN_STORAGE_UNAVAILABLE', 'Account storage is not ready. Apply the latest Worker D1 migrations, then retry.');
  }
  let authCreated = false;
  let profileCreated = false;
  let credentialStaged = false;
  let accessToken = '';
  try {
    accessToken = await createFirebaseServiceAccessToken(env, 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit');
    const created = await firebasePasswordRequest(env, { email, password, returnSecureToken: true }, 'signUp');
    if (!created.result.ok || !created.payload?.localId) {
      const duplicate = created.payload?.error?.message?.includes('EMAIL_EXISTS');
      jsonError(duplicate ? 409 : 502, duplicate ? 'EMAIL_ALREADY_EXISTS' : 'FIREBASE_AUTH_CREATE_FAILED', duplicate ? 'This email is already assigned to a Firebase account.' : 'Could not create the Firebase account.');
    }
    authCreated = true;
    uid = created.payload.localId;
    const reserved = await env.DB.prepare("UPDATE app_user_logins SET profile_uid = ?, updated_at = ? WHERE profile_uid = ? AND status = 'PROVISIONING'")
      .bind(uid, new Date().toISOString(), reservationUid).run();
    if (reserved.meta?.changes !== 1) throw new Error('Could not link the reserved username to the Firebase account.');
    const cipher = await encryptSecret(env, password, `app-user-password:${uid}`);
    await createWorkspaceProfileDocument(env, accessToken, uid, {
      email, username, name, ...(studentId ? { studentId } : {}), ...(major ? { major } : {}), role,
      status: 'APPROVED', isActive: true, loginProvider: 'password',
      credentialEmailStatus: 'PENDING', createdAt: { timestampValue: now }, updatedAt: { timestampValue: now },
    });
    profileCreated = true;
    await env.DB.prepare(`INSERT INTO app_user_pending_credentials (profile_uid, ciphertext, nonce, key_version, email, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(uid, cipher.ciphertext, cipher.nonce, cipher.keyVersion, email, expiry, now).run();
    credentialStaged = true;
    const linked = await env.DB.prepare("UPDATE app_user_logins SET status = 'LINKED', updated_at = ? WHERE profile_uid = ? AND status = 'PROVISIONING'").bind(new Date().toISOString(), uid).run();
    if (linked.meta?.changes !== 1) throw new Error('Could not activate the username mapping.');
  } catch (error) {
    if (profileCreated && accessToken) await deleteWorkspaceProfileDocument(env, accessToken, uid).catch(() => undefined);
    if (authCreated && accessToken) await deleteFirebaseAuthUser(env, accessToken, uid).catch(() => undefined);
    if (credentialStaged) await env.DB.prepare('DELETE FROM app_user_pending_credentials WHERE profile_uid = ?').bind(uid).run();
    await env.DB.prepare('DELETE FROM app_user_logins WHERE profile_uid = ?').bind(uid).run();
    await env.DB.prepare('DELETE FROM app_user_logins WHERE profile_uid = ?').bind(reservationUid).run();
    if (error instanceof ApiError) throw error;
    throw error;
  }
  let onboardingEmailSent = false;
  try {
    await sendAppUserCredentials(env, email, name, username, password);
    onboardingEmailSent = true;
    await env.DB.prepare('DELETE FROM app_user_pending_credentials WHERE profile_uid = ?').bind(uid).run();
    await patchRegistrationProfile(env, accessToken, uid, { credentialEmailStatus: 'SENT', updatedAt: { timestampValue: new Date().toISOString() } });
  } catch (error) {
    await patchRegistrationProfile(env, accessToken, uid, { credentialEmailStatus: 'FAILED', updatedAt: { timestampValue: new Date().toISOString() } }).catch(() => undefined);
    console.error('Application account credential email failed', error instanceof Error ? error.message : 'unknown');
  }
  await audit(env, identity.uid, 'APP_USER_CREATED', 'SUCCESS', uid, `username:${username};email-sent:${onboardingEmailSent}`);
  return response({ id: uid, email, username, name, role, status: 'APPROVED', isActive: true, createdAt: now, updatedAt: now, onboardingEmailSent }, onboardingEmailSent ? 'Account created and sign-in details emailed.' : 'Account created, but credential email delivery failed. Retry from Admin users.', 201);
}

async function resendAppUserCredentials(uid: string, env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'workspace.create', env);
  await rateLimit(env, identity.uid, 'app-user-credential-resend', 10, 600);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) jsonError(400, 'VALIDATION_ERROR', 'Invalid application user identifier.');
  const row = await env.DB.prepare(`SELECT c.ciphertext, c.nonce, c.key_version, c.email, c.expires_at, l.username
    FROM app_user_pending_credentials c JOIN app_user_logins l ON l.profile_uid = c.profile_uid
    WHERE c.profile_uid = ? AND l.status = 'LINKED'`).bind(uid).first<{ ciphertext: string; nonce: string; key_version: string; email: string; expires_at: string; username: string }>();
  if (!row || row.expires_at <= new Date().toISOString()) {
    if (row) await env.DB.prepare('DELETE FROM app_user_pending_credentials WHERE profile_uid = ?').bind(uid).run();
    jsonError(410, 'CREDENTIAL_RETRY_EXPIRED', 'Credential retry has expired. Reset the account password before resending.');
  }
  const serviceToken = await createFirebaseServiceAccessToken(env, 'https://www.googleapis.com/auth/datastore');
  const profileResult = await fetch(`${firestoreBase(env)}/userProfiles/${encodeURIComponent(uid)}`, { headers: { authorization: `Bearer ${serviceToken}` } });
  if (!profileResult.ok) jsonError(404, 'APP_USER_NOT_FOUND', 'The application profile was not found.');
  const profileDocument = await profileResult.json() as FirestoreDocument;
  const name = String(firestoreField(profileDocument, 'name') || '');
  const password = await decryptSecret(env, { ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.key_version }, `app-user-password:${uid}`);
  await sendAppUserCredentials(env, row.email, name, row.username, password);
  await env.DB.prepare('DELETE FROM app_user_pending_credentials WHERE profile_uid = ?').bind(uid).run();
  await patchRegistrationProfile(env, serviceToken, uid, { credentialEmailStatus: 'SENT', updatedAt: { timestampValue: new Date().toISOString() } });
  return response({ id: uid, onboardingEmailSent: true }, 'Sign-in details sent.');
}

export async function usernameLogin(request: Request, env: WorkspaceEnv) {
  const input = await parseJson(request);
  const username = normalizeUsername(input.username);
  const password = typeof input.password === 'string' ? input.password : '';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const limiterId = `login:${await sha256(`${ip}|${username}`).then((value) => value.slice(0, 32))}`;
  await rateLimit(env, limiterId, 'username-login', 8, 600);
  const row = /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)
    ? await env.DB.prepare("SELECT profile_uid, email FROM app_user_logins WHERE username = ? AND status = 'LINKED'").bind(username).first<{ profile_uid: string; email: string }>()
    : null;
  if (!password || password.length > 128) jsonError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect.');
  const auth = await firebasePasswordRequest(env, { email: row?.email || 'unknown-username@invalid.invalid', password, returnSecureToken: true }, 'signInWithPassword');
  if (!row || !auth.result.ok || !auth.payload?.localId || auth.payload.localId !== row.profile_uid) jsonError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect.');
  const serviceToken = await createFirebaseServiceAccessToken(env, 'https://www.googleapis.com/auth/datastore');
  const profileResult = await fetch(`${firestoreBase(env)}/userProfiles/${encodeURIComponent(row.profile_uid)}`, { headers: { authorization: `Bearer ${serviceToken}` } });
  if (!profileResult.ok) jsonError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect.');
  const document = await profileResult.json() as FirestoreDocument;
  if (firestoreField(document, 'isActive') !== true || firestoreField(document, 'status') !== 'APPROVED') jsonError(403, 'ACCOUNT_NOT_ACTIVE', 'This account is not active. Contact an administrator.');
  const customToken = await createFirebaseCustomToken(env, row.profile_uid);
  return response({ customToken }, 'Signed in successfully.');
}

type FirestoreValue = Record<string, unknown>;

function decodeFirestoreValue(value: FirestoreValue): unknown {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) {
    const array = value.arrayValue as { values?: FirestoreValue[] };
    return (array.values || []).map(decodeFirestoreValue);
  }
  if ('mapValue' in value) {
    const map = value.mapValue as { fields?: Record<string, FirestoreValue> };
    return Object.fromEntries(Object.entries(map.fields || {}).map(([key, item]) => [key, decodeFirestoreValue(item)]));
  }
  return undefined;
}

function encodeFirestoreValue(value: unknown): FirestoreValue {
  if (value && typeof value === 'object' && 'timestampValue' in value) return value as FirestoreValue;
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encodeFirestoreValue(item)])) } };
  return { stringValue: String(value) };
}

async function loadRegistrationApplication(env: WorkspaceEnv, token: string, uid: string) {
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents`;
  for (const collection of ['userProfiles', 'registrationRequests'] as const) {
    const result = await fetch(`${base}/${collection}/${encodeURIComponent(uid)}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
    });
    if (result.status === 404) continue;
    if (!result.ok) jsonError(result.status === 403 ? 403 : 502, result.status === 403 ? 'WORKSPACE_PERMISSION_DENIED' : 'FIRESTORE_UNAVAILABLE', result.status === 403 ? 'The administrator cannot read this application.' : 'Could not load the registration application.');
    const document = await result.json() as { fields?: Record<string, FirestoreValue> };
    const values = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)])) as Record<string, unknown>;
    return { values, profileExists: collection === 'userProfiles' };
  }
  jsonError(404, 'REGISTRATION_NOT_FOUND', 'The registration application was not found.');
}

async function patchRegistrationProfile(env: WorkspaceEnv, token: string, uid: string, values: Record<string, unknown>) {
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/userProfiles/${encodeURIComponent(uid)}`);
  for (const field of Object.keys(values)) url.searchParams.append('updateMask.fieldPaths', field);
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  const result = await fetch(url, {
    method: 'PATCH', signal: AbortSignal.timeout(8000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!result.ok) jsonError(result.status === 403 ? 403 : 502, result.status === 403 ? 'WORKSPACE_PERMISSION_DENIED' : 'FIRESTORE_UNAVAILABLE', result.status === 403 ? 'The administrator cannot update this profile.' : 'Could not approve the registration profile.');
}

async function patchRegistrationRequest(env: WorkspaceEnv, token: string, uid: string, values: Record<string, unknown>) {
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/registrationRequests/${encodeURIComponent(uid)}`);
  for (const field of Object.keys(values)) url.searchParams.append('updateMask.fieldPaths', field);
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  const result = await fetch(url, {
    method: 'PATCH', signal: AbortSignal.timeout(8000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (result.status === 404) return;
  if (!result.ok) jsonError(result.status === 403 ? 403 : 502, result.status === 403 ? 'WORKSPACE_PERMISSION_DENIED' : 'FIRESTORE_UNAVAILABLE', result.status === 403 ? 'The administrator cannot update this registration request.' : 'Could not update the registration request.');
}

async function profileEmailExists(env: WorkspaceEnv, serviceAccessToken: string, field: 'email' | 'workspaceEmail', email: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents:runQuery`;
  const result = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { authorization: `Bearer ${serviceAccessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'userProfiles' }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: email } } },
      limit: 1,
    } }),
  });
  if (!result.ok) {
    console.error('Workspace duplicate-profile check failed', result.status);
    const permissionFailure = result.status === 401 || result.status === 403;
    jsonError(permissionFailure ? 503 : 502, 'FIRESTORE_DUPLICATE_CHECK_FAILED', permissionFailure
      ? 'The Worker service account cannot query application profiles.'
      : 'Could not verify duplicate application profiles.');
  }
  const rows = await result.json() as Array<{ document?: { name?: string } }>;
  return rows.some((row) => Boolean(row.document?.name));
}

async function createWorkspaceProfileDocument(env: WorkspaceEnv, accessToken: string, uid: string, values: Record<string, unknown>) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/userProfiles?documentId=${encodeURIComponent(uid)}`;
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  const result = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (result.status === 409) jsonError(409, 'PROFILE_ALREADY_EXISTS', 'A profile with this identity already exists.');
  if (!result.ok) {
    console.error('Workspace profile create failed', result.status);
    jsonError(502, 'FIRESTORE_UNAVAILABLE', 'Could not create the application profile.');
  }
}

async function deleteWorkspaceProfileDocument(env: WorkspaceEnv, accessToken: string, uid: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/userProfiles/${encodeURIComponent(uid)}`;
  const result = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(8000), headers: { authorization: `Bearer ${accessToken}` } });
  if (!result.ok && result.status !== 404) throw new Error(`Firestore profile rollback failed (${result.status}).`);
}

async function createLinkedWorkspaceProfile(request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity, firebaseToken: string) {
  await authorize(identity, 'workspace.create', env);
  await rateLimit(env, identity.uid, 'profile-create', 10, 600);
  if (!firebaseToken) jsonError(401, 'UNAUTHENTICATED', 'Firebase authentication is required.');

  const input = await parseJson(request);
  const workspaceEmail = validateEmail(input.email, env);
  const personalEmail = typeof input.personalEmail === 'string' ? input.personalEmail.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) jsonError(400, 'CONTACT_EMAIL_REQUIRED', 'Enter a valid personal email address for the access notice.');
  if (personalEmail === workspaceEmail) jsonError(400, 'CONTACT_EMAIL_REQUIRED', 'The access-notice email must differ from the Workspace email.');
  const role = input.role;
  if (role !== 'ADMIN' && role !== 'LECTURER' && role !== 'STUDENT') jsonError(400, 'VALIDATION_ERROR', 'Choose a supported application role.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length > 160) jsonError(400, 'VALIDATION_ERROR', 'Name must be at most 160 characters.');
  const studentId = typeof input.studentId === 'string' ? input.studentId.trim() : '';
  const major = typeof input.major === 'string' ? input.major.trim() : '';
  if (studentId.length > 50 || major.length > 120) jsonError(400, 'VALIDATION_ERROR', 'Student ID or major exceeds the allowed length.');

  let accessToken: string;
  try {
    accessToken = await createFirebaseServiceAccessToken(env, 'https://www.googleapis.com/auth/datastore');
  } catch (error) {
    console.error('Firebase service access token failed', error instanceof Error ? error.message : 'unknown');
    jsonError(503, 'FIREBASE_ADMIN_UNAVAILABLE', 'The Worker could not access Firebase profile storage.');
  }

  if (await profileEmailExists(env, accessToken, 'email', workspaceEmail)
    || await profileEmailExists(env, accessToken, 'workspaceEmail', workspaceEmail)) {
    await audit(env, identity.uid, 'WORKSPACE_PROFILE_CREATED', 'DENIED', workspaceEmail, 'duplicate-profile-email');
    jsonError(409, 'PROFILE_EMAIL_ALREADY_ASSIGNED', 'This Workspace email is already assigned to an application profile.');
  }

  let directoryUser: Record<string, unknown>;
  try {
    directoryUser = await googleApi<Record<string, unknown>>(env, `/users/${encodeURIComponent(workspaceEmail)}`, {}, true);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'WORKSPACE_USER_NOT_FOUND') {
      jsonError(404, 'WORKSPACE_ACCOUNT_NOT_FOUND', 'Only an existing Workspace mailbox can be linked. No mailbox was created.');
    }
    throw error;
  }
  if (String(directoryUser.primaryEmail || '').toLowerCase() !== workspaceEmail) jsonError(400, 'WORKSPACE_PRIMARY_EMAIL_REQUIRED', 'Use the Workspace account’s primary email address, not an alias.');
  if (directoryUser.suspended === true) jsonError(409, 'WORKSPACE_ACCOUNT_SUSPENDED', 'Restore this Workspace account before linking it to a profile.');
  const directoryName = (directoryUser.name && typeof directoryUser.name === 'object' ? directoryUser.name : {}) as Record<string, unknown>;
  const profileName = name || String(directoryName.fullName || '').trim();
  if (!profileName) jsonError(400, 'VALIDATION_ERROR', 'Enter a profile name or add a name to the Workspace account.');
  const profileNameParts = profileName.split(/\s+/);
  const firstName = String(name ? profileNameParts[0] : directoryName.givenName || profileNameParts[0] || '').trim();
  const lastName = String(name ? profileNameParts.slice(1).join(' ') : directoryName.familyName || profileNameParts.slice(1).join(' ') || '').trim();

  const uid = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT INTO workspace_identity_links
      (profile_uid, workspace_email, workspace_user_id, personal_email, status, onboarding_email_status, linked_by_uid, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'PROVISIONING', 'PENDING', ?, ?, ?)`)
      .bind(uid, workspaceEmail, String(directoryUser.id || workspaceEmail), personalEmail, identity.uid, now, now).run();
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) {
      jsonError(409, 'WORKSPACE_EMAIL_ALREADY_LINKED', 'This Workspace email is already linked to another application profile.');
    }
    throw error;
  }

  let profileCreated = false;
  try {
    await createWorkspaceProfileDocument(env, accessToken, uid, {
      email: workspaceEmail,
      workspaceEmail,
      name: profileName,
      firstName,
      lastName,
      ...(studentId ? { studentId } : {}),
      ...(major ? { major } : {}),
      role,
      status: 'APPROVED',
      isActive: true,
      loginProvider: 'google.com',
      createdAt: { timestampValue: now },
      updatedAt: { timestampValue: now },
    });
    profileCreated = true;
    const linked = await env.DB.prepare("UPDATE workspace_identity_links SET status = 'LINKED', updated_at = ? WHERE profile_uid = ? AND status = 'PROVISIONING'")
      .bind(new Date().toISOString(), uid).run();
    if (linked.meta?.changes !== 1) throw new Error('D1 profile link could not be finalized.');
  } catch (error) {
    if (profileCreated) {
      try { await deleteWorkspaceProfileDocument(env, accessToken, uid); }
      catch (rollbackError) { console.error('Workspace profile rollback failed', rollbackError instanceof Error ? rollbackError.message : 'unknown'); }
    }
    await env.DB.prepare("DELETE FROM workspace_identity_links WHERE profile_uid = ? AND status = 'PROVISIONING'").bind(uid).run();
    if (error instanceof ApiError) throw error;
    console.error('Workspace profile linking failed', error instanceof Error ? error.message : 'unknown');
    jsonError(502, 'PROFILE_LINK_FAILED', 'The application profile could not be linked. Try again or contact support.');
  }

  await audit(env, identity.uid, 'WORKSPACE_PROFILE_CREATED', 'SUCCESS', String(directoryUser.id || workspaceEmail), workspaceEmail);
  let emailSent = true;
  try {
    const stagedCredential = await stagedTemporaryPassword(env, workspaceEmail);
    await sendWorkspaceOnboarding(env, personalEmail, profileName || 'ResearchPulse user', workspaceEmail, stagedCredential?.password);
    if (stagedCredential) await discardStagedTemporaryPassword(env, workspaceEmail);
    await env.DB.prepare("UPDATE workspace_identity_links SET onboarding_email_status = 'SENT', updated_at = ? WHERE profile_uid = ?")
      .bind(new Date().toISOString(), uid).run();
  } catch (error) {
    emailSent = false;
    await env.DB.prepare("UPDATE workspace_identity_links SET onboarding_email_status = 'FAILED', updated_at = ? WHERE profile_uid = ?")
      .bind(new Date().toISOString(), uid).run();
    await audit(env, identity.uid, 'WORKSPACE_PROFILE_ONBOARDING_EMAIL_FAILED', 'FAILED', workspaceEmail);
    if (!(error instanceof ApiError)) console.error('Workspace profile onboarding email failed', error instanceof Error ? error.message : 'unknown');
  }
  return response({ id: uid, email: workspaceEmail, workspaceEmail, personalEmail, onboardingEmailSent: emailSent, name: profileName, role, status: 'APPROVED', isActive: true },
    emailSent ? 'Application profile created, linked, and sign-in details emailed.' : 'Application profile created and linked, but the access email could not be delivered. Use Resend access to retry.', 201);
}

function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}

function frontendLoginUrl(env: WorkspaceEnv) {
  const configuredOrigins = (env.FRONTEND_ORIGINS || env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  const candidates = [...configuredOrigins, env.FRONTEND_URL?.trim() || ''];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') return `${url.origin}/login`;
    } catch { /* Ignore malformed configured origins. */ }
  }
  return null;
}

async function sendWorkspaceOnboarding(env: WorkspaceEnv, email: string, name: string, workspaceEmail: string, temporaryPassword?: string) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) jsonError(503, 'EMAIL_DELIVERY_NOT_CONFIGURED', 'Resend is not configured on the Worker.');
  const safeName = htmlEscape(name || 'bạn');
  const safeEmail = htmlEscape(workspaceEmail);
  const loginUrl = frontendLoginUrl(env);
  const safeLoginUrl = loginUrl ? htmlEscape(loginUrl) : '';
  const subject = 'HyperDataLab | Tài khoản của bạn đã sẵn sàng';
  const passwordText = temporaryPassword
    ? `\nMật khẩu tạm thời: ${temporaryPassword}\nGoogle sẽ yêu cầu bạn đổi mật khẩu khi đăng nhập lần đầu.`
    : '';
  const passwordHtml = temporaryPassword
    ? `<tr><td style="padding:0 32px 24px"><div style="background:#f0f7ff;border:1px solid #cfe5ff;border-radius:10px;padding:18px 20px"><div style="font:600 13px Arial,sans-serif;color:#475569;margin-bottom:9px">MẬT KHẨU TẠM THỜI</div><div style="font:600 18px Consolas,'Courier New',monospace;letter-spacing:.3px;color:#0f172a;word-break:break-all">${htmlEscape(temporaryPassword)}</div><div style="font:13px/1.55 Arial,sans-serif;color:#475569;margin-top:10px">Hãy đổi mật khẩu khi đăng nhập Google lần đầu. Vì lý do bảo mật, email này là lần duy nhất hệ thống gửi mật khẩu.</div></div></td></tr>`
    : '';
  const loginText = loginUrl ? `\nMở HyperDataLab: ${loginUrl}` : '\nMở ứng dụng HyperDataLab và chọn “Đăng nhập bằng Google Workspace”.';
  const loginButton = loginUrl
    ? `<a href="${safeLoginUrl}" style="display:inline-block;background:#0879c9;color:#fff;text-decoration:none;font:600 15px Arial,sans-serif;padding:13px 22px;border-radius:8px">Đăng nhập HyperDataLab</a>`
    : '<span style="font:600 15px Arial,sans-serif;color:#0879c9">Mở ứng dụng HyperDataLab và chọn Đăng nhập bằng Google Workspace.</span>';
  const text = `Xin chào ${name || 'bạn'},\n\nHồ sơ của bạn đã được duyệt và liên kết với tài khoản Google Workspace:\n${workspaceEmail}${passwordText}\n\nDùng tài khoản Workspace này để đăng nhập HyperDataLab bằng nút Google Workspace.${loginText}\n\nEmail cá nhân này chỉ dùng để nhận thông báo từ hệ thống.`;
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f6fa;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#172033"><div style="display:none;max-height:0;overflow:hidden;opacity:0">Hồ sơ HyperDataLab của bạn đã được duyệt và liên kết với email Workspace.</div><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e1e8f0;border-radius:14px;overflow:hidden"><tr><td style="padding:24px 32px;border-bottom:1px solid #e8edf3"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:38px;height:38px;background:#eaf5ff;border-radius:10px;text-align:center;vertical-align:middle;color:#0879c9;font:bold 16px Arial">HD</td><td style="padding-left:11px;font:bold 18px Arial,sans-serif;color:#172033">HyperDataLab</td></tr></table></td></tr><tr><td style="padding:30px 32px 10px"><div style="display:inline-block;background:#eaf8f0;color:#18794e;font:600 12px Arial,sans-serif;padding:6px 10px;border-radius:20px">HỒ SƠ ĐÃ ĐƯỢC DUYỆT</div><h1 style="font:700 24px/1.3 Arial,sans-serif;color:#172033;margin:18px 0 10px">Tài khoản của bạn đã sẵn sàng</h1><p style="font:15px/1.65 Arial,sans-serif;color:#526176;margin:0">Xin chào ${safeName}, hồ sơ HyperDataLab của bạn đã được duyệt.</p></td></tr><tr><td style="padding:16px 32px 22px"><div style="font:13px Arial,sans-serif;color:#64748b;margin-bottom:8px">EMAIL GOOGLE WORKSPACE</div><div style="background:#f8fafc;border:1px solid #e3eaf2;border-radius:8px;padding:13px 15px;font:600 16px Arial,sans-serif;color:#172033;word-break:break-all">${safeEmail}</div></td></tr>${passwordHtml}<tr><td style="padding:0 32px 24px"><div style="font:15px/1.65 Arial,sans-serif;color:#526176;margin-bottom:18px">Dùng email Workspace ở trên để đăng nhập HyperDataLab bằng Google. Email cá nhân này chỉ dùng để nhận thông báo.</div>${loginButton}</td></tr><tr><td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e8edf3;font:12px/1.6 Arial,sans-serif;color:#718096">Nếu bạn không mong đợi email này, hãy liên hệ Ban Quản trị HyperDataLab. Đây là thư tự động, vui lòng không trả lời.</td></tr></table></body></html>`;
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [email],
      subject,
      text,
      html,
    }),
  });
  if (!result.ok) {
    console.error('Resend delivery failed', result.status);
    jsonError(502, 'ONBOARDING_EMAIL_FAILED', 'The profile was linked, but the access notice could not be delivered. Use the resend action after checking Resend configuration.');
  }
}

async function approveRegistration(request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity, firebaseToken: string) {
  await authorize(identity, 'workspace.create', env);
  await rateLimit(env, identity.uid, 'registration-approve', 10, 600);
  if (!firebaseToken) jsonError(401, 'UNAUTHENTICATED', 'Firebase authentication is required.');
  const input = await parseJson(request);
  const profileUid = typeof input.userId === 'string' ? input.userId.trim() : '';
  if (!profileUid || profileUid.length > 128 || /[/?#]/.test(profileUid)) jsonError(400, 'VALIDATION_ERROR', 'A valid profile userId is required.');
  const workspaceEmail = validateEmail(input.workspaceEmail, env);
  const application = await loadRegistrationApplication(env, firebaseToken, profileUid);
  const profile = application.values;
  const personalEmail = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) jsonError(400, 'PROFILE_EMAIL_INVALID', 'The profile does not have a valid contact email.');
  if (personalEmail === workspaceEmail) jsonError(400, 'CONTACT_EMAIL_REQUIRED', 'The new Workspace address must differ from the applicant’s contact email.');
  if (profile.role !== 'ADMIN' && (allowedAdminEmails(env).has(workspaceEmail) || (await getConnection(env))?.admin_email === workspaceEmail)) {
    jsonError(403, 'PROTECTED_ADMIN_ACCOUNT', 'The connected or allowlisted Workspace administrator address cannot be linked to an applicant.');
  }
  if (typeof profile.workspaceEmail === 'string' && profile.workspaceEmail.toLowerCase() !== workspaceEmail) {
    jsonError(409, 'PROFILE_ALREADY_LINKED', 'This profile already has a different Workspace email assigned.');
  }
  if (profile.status === 'REJECTED' || profile.status === 'SUSPENDED') jsonError(409, 'REGISTRATION_NOT_APPROVABLE', 'Rejected or suspended profiles cannot be approved.');
  const inputFirstName = typeof input.firstName === 'string' ? input.firstName.trim() : '';
  const inputLastName = typeof input.lastName === 'string' ? input.lastName.trim() : '';
  const storedFirstName = typeof profile.firstName === 'string' ? profile.firstName.trim() : '';
  const storedLastName = typeof profile.lastName === 'string' ? profile.lastName.trim() : '';
  const storedName = typeof profile.name === 'string' ? profile.name.trim() : '';
  const firstName = inputFirstName || storedFirstName || storedName.split(/\s+/)[0] || '';
  const lastName = inputLastName || storedLastName || storedName.split(/\s+/).slice(1).join(' ') || '';
  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) jsonError(400, 'VALIDATION_ERROR', 'First and last name are required and must be at most 100 characters.');
  const studentId = typeof input.studentId === 'string' ? input.studentId.trim() : (typeof profile.studentId === 'string' ? profile.studentId : '');
  const major = typeof input.major === 'string' ? input.major.trim() : (typeof profile.major === 'string' ? profile.major : '');
  if (studentId.length > 50 || major.length > 120) jsonError(400, 'VALIDATION_ERROR', 'Student ID or major exceeds the allowed length.');
  const fullName = `${firstName} ${lastName}`.trim();
  const currentLink = await env.DB.prepare('SELECT profile_uid, workspace_email, workspace_user_id, status, onboarding_email_status, workspace_account_created, created_at FROM workspace_identity_links WHERE profile_uid = ?')
    .bind(profileUid).first<{ profile_uid: string; workspace_email: string; workspace_user_id: string; status: string; onboarding_email_status: string; workspace_account_created: number; created_at: string }>();
  if (profile.status === 'APPROVED' && !currentLink) jsonError(409, 'REGISTRATION_NOT_PENDING', 'Only a pending registration can be linked to a Workspace mailbox.');
  if (currentLink && currentLink.workspace_email !== workspaceEmail) jsonError(409, 'PROFILE_ALREADY_LINKED', 'This profile already has a different Workspace email assigned.');
  if (currentLink?.status === 'LINKED') {
    if (profile.status !== 'APPROVED' || profile.workspaceEmail !== workspaceEmail) jsonError(409, 'REGISTRATION_ALREADY_APPROVED', 'This profile is already linked to a Workspace account.');
    await patchRegistrationRequest(env, firebaseToken, profileUid, { status: 'APPROVED', reviewedAt: { timestampValue: new Date().toISOString() }, reviewedById: identity.uid });
    return response({ profileUid, workspaceEmail, personalEmail, onboardingEmailSent: currentLink.onboarding_email_status === 'SENT', workspaceAccountCreated: currentLink.workspace_account_created === 1 },
      'Registration approval is already finalized.', 200);
  }
  if (currentLink?.status === 'SUSPENDED') jsonError(409, 'WORKSPACE_ACCOUNT_SUSPENDED', 'This profile is already linked to a suspended Workspace account. Restore it before continuing.');

  const now = new Date().toISOString();
  const link = currentLink || {
    profile_uid: profileUid, workspace_email: workspaceEmail, workspace_user_id: `provisioning:${profileUid}`,
    status: 'PROVISIONING', onboarding_email_status: 'PENDING', workspace_account_created: 0,
  };
  if (!currentLink) {
    try {
      await env.DB.prepare(`INSERT INTO workspace_identity_links
        (profile_uid, workspace_email, workspace_user_id, personal_email, status, onboarding_email_status, linked_by_uid, created_at, updated_at, workspace_account_created)
        VALUES (?, ?, ?, ?, 'PROVISIONING', 'PENDING', ?, ?, ?, 0)`)
        .bind(profileUid, workspaceEmail, link.workspace_user_id, personalEmail, identity.uid, now, now).run();
    } catch {
      jsonError(409, 'WORKSPACE_LINK_CONFLICT', 'This Workspace email or application profile is already being provisioned.');
    }
  }

  let workspaceUser: Record<string, unknown>;
  try {
    // Approval only links mailboxes provisioned explicitly by an administrator.
    workspaceUser = await googleApi<Record<string, unknown>>(env, `/users/${encodeURIComponent(workspaceEmail)}`, {}, true);
  } catch (error) {
    await env.DB.prepare('DELETE FROM workspace_identity_links WHERE profile_uid = ? AND status = ?').bind(profileUid, 'PROVISIONING').run();
    if (error instanceof ApiError && error.code === 'WORKSPACE_USER_NOT_FOUND') {
      jsonError(409, 'WORKSPACE_ACCOUNT_REQUIRED', 'Create the Workspace mailbox in Admin account management before approving this registration.');
    }
    throw error;
  }

  const workspaceUserId = String(workspaceUser.id || link.workspace_user_id || workspaceEmail);
  const primaryEmail = typeof workspaceUser.primaryEmail === 'string' ? workspaceUser.primaryEmail.toLowerCase() : '';
  if (primaryEmail !== workspaceEmail) {
    await env.DB.prepare('DELETE FROM workspace_identity_links WHERE profile_uid = ? AND status = ?').bind(profileUid, 'PROVISIONING').run();
    jsonError(409, 'WORKSPACE_PRIMARY_EMAIL_MISMATCH', 'Use the Workspace account primary email address, not an alias.');
  }
  if (workspaceUser.suspended === true) {
    await env.DB.prepare('DELETE FROM workspace_identity_links WHERE profile_uid = ? AND status = ?').bind(profileUid, 'PROVISIONING').run();
    jsonError(409, 'WORKSPACE_ACCOUNT_SUSPENDED', 'Restore the Workspace account before approving this registration.');
  }

  await env.DB.prepare('UPDATE workspace_identity_links SET workspace_user_id = ?, personal_email = ?, workspace_account_created = 0, updated_at = ? WHERE profile_uid = ? AND status = ?')
    .bind(workspaceUserId, personalEmail, new Date().toISOString(), profileUid, 'PROVISIONING').run();
  try {
    if (application.profileExists) {
      await patchRegistrationProfile(env, firebaseToken, profileUid, {
        name: fullName, firstName, lastName,
        ...(studentId ? { studentId } : {}),
        ...(major ? { major } : {}),
        workspaceEmail, loginProvider: 'google.com', status: 'APPROVED', isActive: true,
        approvedAt: { timestampValue: now }, approvedById: identity.uid, updatedAt: { timestampValue: now },
      });
    } else {
      const serviceAccessToken = await createFirebaseServiceAccessToken(env, 'https://www.googleapis.com/auth/datastore');
      await createWorkspaceProfileDocument(env, serviceAccessToken, profileUid, {
        email: personalEmail,
        firstName,
        lastName,
        name: fullName,
        studentId,
        major,
        ...(typeof profile.phone === 'string' && profile.phone ? { phone: profile.phone } : {}),
        workspaceEmail,
        loginProvider: 'google.com',
        role: profile.role === 'ADMIN' || profile.role === 'LECTURER' ? profile.role : 'STUDENT',
        status: 'APPROVED',
        isActive: true,
        createdAt: typeof profile.createdAt === 'string' ? { timestampValue: profile.createdAt } : { timestampValue: now },
        approvedAt: { timestampValue: now },
        approvedById: identity.uid,
        updatedAt: { timestampValue: now },
      });
    }
    await env.DB.prepare("UPDATE workspace_identity_links SET status = 'LINKED', updated_at = ? WHERE profile_uid = ? AND status = 'PROVISIONING'")
      .bind(new Date().toISOString(), profileUid).run();
    await patchRegistrationRequest(env, firebaseToken, profileUid, {
      status: 'APPROVED', reviewedAt: { timestampValue: now }, reviewedById: identity.uid,
    });
  } catch (error) {
    console.error('Workspace profile linking failed; provisioning state retained for retry', error instanceof Error ? error.message : 'unknown');
    jsonError(502, 'WORKSPACE_LINK_INCOMPLETE', 'The existing Workspace mailbox was verified, but the application profile could not be finalized. Retry approval to complete the link.');
  }
  await audit(env, identity.uid, 'WORKSPACE_PROFILE_LINKED', 'SUCCESS', workspaceUserId, workspaceEmail);

  let emailSent = true;
  try {
    const stagedCredential = await stagedTemporaryPassword(env, workspaceEmail);
    await sendWorkspaceOnboarding(env, personalEmail, fullName || 'ResearchPulse user', workspaceEmail, stagedCredential?.password);
    if (stagedCredential) await discardStagedTemporaryPassword(env, workspaceEmail);
    await env.DB.prepare("UPDATE workspace_identity_links SET onboarding_email_status = 'SENT', updated_at = ? WHERE profile_uid = ?")
      .bind(new Date().toISOString(), profileUid).run();
  } catch (error) {
    emailSent = false;
    await env.DB.prepare("UPDATE workspace_identity_links SET onboarding_email_status = 'FAILED', updated_at = ? WHERE profile_uid = ?")
      .bind(new Date().toISOString(), profileUid).run();
    await audit(env, identity.uid, 'WORKSPACE_ONBOARDING_EMAIL_FAILED', 'FAILED', workspaceEmail);
    if (!(error instanceof ApiError)) throw error;
  }
  return response({ profileUid, workspaceEmail, personalEmail, onboardingEmailSent: emailSent, workspaceAccountCreated: false },
    emailSent ? 'Registration approved and linked to the existing Workspace account; sign-in instructions emailed.' : 'Registration approved and linked to the existing Workspace account; sign-in email failed. Use the resend action to retry.', 200);
}

async function resendWorkspaceOnboarding(_request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity, firebaseToken: string, profileUid: string) {
  await authorize(identity, 'workspace.update', env);
  await rateLimit(env, identity.uid, 'registration-resend', 10, 600);
  if (!firebaseToken || !profileUid || profileUid.length > 128 || /[/?#]/.test(profileUid)) jsonError(400, 'VALIDATION_ERROR', 'A valid profile userId is required.');
  const link = await env.DB.prepare('SELECT profile_uid, workspace_email, workspace_user_id, personal_email, status, workspace_account_created FROM workspace_identity_links WHERE profile_uid = ?')
    .bind(profileUid).first<{ profile_uid: string; workspace_email: string; workspace_user_id: string; personal_email: string; status: string; workspace_account_created: number }>();
  if (!link || link.status !== 'LINKED') jsonError(404, 'WORKSPACE_LINK_NOT_FOUND', 'A linked Workspace account was not found for this profile.');
  const { values: profile } = await loadRegistrationApplication(env, firebaseToken, profileUid);
  if (profile.workspaceEmail !== link.workspace_email || profile.isActive !== true || profile.status !== 'APPROVED') {
    jsonError(409, 'PROFILE_NOT_ACTIVE', 'The linked application profile is not active.');
  }
  const user = await googleApi<Record<string, unknown>>(env, `/users/${encodeURIComponent(link.workspace_email)}`, {}, true);
  if (String(user.primaryEmail || '').toLowerCase() !== link.workspace_email) jsonError(409, 'WORKSPACE_EMAIL_CHANGED', 'The linked Workspace primary email changed. Contact an administrator to relink it.');
  if (user.suspended === true) jsonError(409, 'WORKSPACE_ACCOUNT_SUSPENDED', 'This Workspace account is suspended. Restore it before resending the notification.');
  try {
    const stagedCredential = await stagedTemporaryPassword(env, link.workspace_email);
    await sendWorkspaceOnboarding(env, link.personal_email, String(profile.name || 'ResearchPulse user'), link.workspace_email, stagedCredential?.password);
    if (stagedCredential) await discardStagedTemporaryPassword(env, link.workspace_email);
    await env.DB.prepare("UPDATE workspace_identity_links SET onboarding_email_status = 'SENT', updated_at = ? WHERE profile_uid = ?")
      .bind(new Date().toISOString(), profileUid).run();
  } catch (error) {
    await env.DB.prepare("UPDATE workspace_identity_links SET onboarding_email_status = 'FAILED', updated_at = ? WHERE profile_uid = ?")
      .bind(new Date().toISOString(), profileUid).run();
    await audit(env, identity.uid, 'WORKSPACE_ONBOARDING_EMAIL_FAILED', 'FAILED', link.workspace_email);
    throw error;
  }
  await audit(env, identity.uid, 'WORKSPACE_ONBOARDING_EMAIL_RESENT', 'SUCCESS', link.workspace_email);
  return response({ profileUid, workspaceEmail: link.workspace_email, onboardingEmailSent: true },
    'Workspace access instructions resent. No Workspace password was changed.');
}

async function exchangeWorkspaceLogin(env: WorkspaceEnv, identity: WorkspaceIdentity) {
  const domain = configuredDomain(env);
  const email = identity.email?.trim().toLowerCase() || '';
  if (identity.signInProvider !== 'google.com' || identity.emailVerified !== true || !email || email.split('@')[1] !== domain) {
    await audit(env, identity.uid, 'WORKSPACE_OPERATION_DENIED', 'DENIED', email || null, 'workspace-sso-identity');
    jsonError(403, 'WORKSPACE_SSO_REQUIRED', 'Sign in using a verified Google Workspace account from the configured domain.');
  }
  const link = await env.DB.prepare("SELECT profile_uid FROM workspace_identity_links WHERE workspace_email = ? AND status = 'LINKED'")
    .bind(email).first<{ profile_uid: string }>();
  if (!link) {
    await audit(env, identity.uid, 'WORKSPACE_OPERATION_DENIED', 'DENIED', email, 'workspace-sso-not-linked');
    jsonError(403, 'WORKSPACE_ACCOUNT_NOT_LINKED', 'This Workspace account has not been linked to an approved application profile. Contact an administrator.');
  }
  const customToken = await createFirebaseCustomToken(env, link.profile_uid);
  return response({ customToken }, 'Workspace identity linked to application profile.');
}

async function updateUser(id: string, request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'workspace.update', env);
  await rateLimit(env, identity.uid, 'user-update', 30, 600);
  const input = await parseJson(request);
  const patch: Record<string, unknown> = {};
  for (const field of allowedUpdateFields) {
    if (!(field in input)) continue;
    const value = input[field];
    if (typeof value !== 'string' || value.length > 254) jsonError(400, 'VALIDATION_ERROR', `${field} must be a string with at most 254 characters.`);
    const normalized = value.trim();
    if (field === 'orgUnitPath' && !normalized.startsWith('/')) jsonError(400, 'VALIDATION_ERROR', 'orgUnitPath must be an absolute path.');
    if (field === 'recoveryEmail' && normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) jsonError(400, 'VALIDATION_ERROR', 'recoveryEmail must be valid.');
    patch[field] = normalized;
  }
  if (!Object.keys(patch).length) jsonError(400, 'VALIDATION_ERROR', 'No supported fields were provided.');
  let current: Record<string, unknown>;
  let primaryEmail = id;
  let updated: Record<string, unknown>;
  try {
    current = await googleApi<Record<string, unknown>>(env, `/users/${encodeURIComponent(id)}`, {}, true);
    primaryEmail = validateEmail(current.primaryEmail, env);
    updated = await googleApi<Record<string, unknown>>(env, `/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }, true);
  } catch (error) {
    await audit(env, identity.uid, 'WORKSPACE_USER_UPDATED', 'FAILED', id, error instanceof ApiError ? error.code : null);
    throw error;
  }
  await audit(env, identity.uid, 'WORKSPACE_USER_UPDATED', 'SUCCESS', String(current.id || id), primaryEmail);
  return response(normalizeUser(updated));
}

async function setSuspended(id: string, suspended: boolean, env: WorkspaceEnv, identity: WorkspaceIdentity, firebaseToken: string) {
  await authorize(identity, 'workspace.suspend', env);
  await rateLimit(env, identity.uid, 'user-suspend', 30, 600);
  let current: Record<string, unknown>;
  let email = id;
  let updated: Record<string, unknown>;
  try {
    current = await googleApi<Record<string, unknown>>(env, `/users/${encodeURIComponent(id)}`, {}, true);
    email = validateEmail(current.primaryEmail, env);
    if (suspended && allowedAdminEmails(env).has(email)) jsonError(403, 'PROTECTED_ADMIN_ACCOUNT', 'Allowlisted Workspace administrator accounts cannot be suspended here.');
    const connection = suspended ? await getConnection(env) : null;
    if (suspended && connection?.admin_email === email) jsonError(403, 'PROTECTED_ADMIN_ACCOUNT', 'The connected Workspace administrator cannot be suspended here.');
    updated = await googleApi<Record<string, unknown>>(env, `/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ suspended }) }, true);
    const link = await env.DB.prepare("SELECT profile_uid FROM workspace_identity_links WHERE workspace_email = ? AND status IN ('LINKED', 'SUSPENDED')")
      .bind(email).first<{ profile_uid: string }>();
    if (link) {
      const now = new Date().toISOString();
      await patchRegistrationProfile(env, firebaseToken, link.profile_uid, {
        status: suspended ? 'SUSPENDED' : 'APPROVED', isActive: !suspended, updatedAt: { timestampValue: now },
      });
      await env.DB.prepare("UPDATE workspace_identity_links SET status = ?, updated_at = ? WHERE workspace_email = ? AND status IN ('LINKED', 'SUSPENDED')")
        .bind(suspended ? 'SUSPENDED' : 'LINKED', now, email).run();
    }
  } catch (error) {
    await audit(env, identity.uid, suspended ? 'WORKSPACE_USER_SUSPENDED' : 'WORKSPACE_USER_RESTORED', 'FAILED', id, error instanceof ApiError ? error.code : null);
    throw error;
  }
  await audit(env, identity.uid, suspended ? 'WORKSPACE_USER_SUSPENDED' : 'WORKSPACE_USER_RESTORED', 'SUCCESS', String(current.id || id), email);
  return response(normalizeUser(updated));
}

async function deleteUser(id: string, request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'workspace.delete', env);
  await rateLimit(env, identity.uid, 'user-delete', 5, 600);
  const input = await parseJson(request);
  let current: Record<string, unknown>;
  let email = id;
  try {
    current = await googleApi<Record<string, unknown>>(env, `/users/${encodeURIComponent(id)}`, {}, true);
    email = validateEmail(current.primaryEmail, env);
  } catch (error) {
    await audit(env, identity.uid, 'WORKSPACE_USER_DELETED', 'FAILED', id, error instanceof ApiError ? error.code : null);
    throw error;
  }
  if (input.confirmEmail !== email) jsonError(400, 'DELETE_CONFIRMATION_REQUIRED', 'confirmEmail must exactly match the Workspace account email.');
  if (allowedAdminEmails(env).has(email)) jsonError(403, 'PROTECTED_ADMIN_ACCOUNT', 'Protected Workspace administrator accounts cannot be deleted.');
  const connection = await getConnection(env);
  if (connection?.admin_email === email) jsonError(403, 'PROTECTED_ADMIN_ACCOUNT', 'The connected Workspace administrator cannot be deleted.');
  const linkedProfile = await env.DB.prepare('SELECT profile_uid FROM workspace_identity_links WHERE workspace_email = ?')
    .bind(email).first<{ profile_uid: string }>();
  if (linkedProfile) jsonError(409, 'WORKSPACE_ACCOUNT_LINKED', 'This Workspace account is linked to an application profile. Suspend it instead of deleting it.');
  let result: unknown;
  try { result = await googleApi<unknown>(env, `/users/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  catch (error) {
    await audit(env, identity.uid, 'WORKSPACE_USER_DELETED', 'FAILED', id, error instanceof ApiError ? error.code : null);
    throw error;
  }
  await audit(env, identity.uid, 'WORKSPACE_USER_DELETED', 'SUCCESS', String(current.id || id), email);
  return response(result, 'Workspace user deleted.');
}

type FirestoreDocument = { name: string; fields?: Record<string, FirestoreValue> };

function firestoreBase(env: WorkspaceEnv) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents`;
}

async function listFirestoreByField(env: WorkspaceEnv, token: string, collection: string, field: string, value: string) {
  const documents: FirestoreDocument[] = [];
  let after: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: 500,
      ...(after ? { startAt: { values: [{ referenceValue: after }], before: false } } : {}),
    };
    // Firestore runQuery is invoked on the documents parent; collection selection
    // belongs in structuredQuery.from rather than the URL path.
    const result = await fetch(`${firestoreBase(env)}:runQuery`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
    });
    if (!result.ok) {
      console.error('App user cleanup query failed', collection, result.status);
      jsonError(502, 'APP_USER_CLEANUP_FAILED', 'Could not safely enumerate all data for this account. No Workspace mailbox was changed.');
    }
    const rows = await result.json() as Array<{ document?: FirestoreDocument }>;
    const pageDocuments = rows.flatMap((row) => row.document ? [row.document] : []);
    if (after && pageDocuments[0]?.name === after) pageDocuments.shift();
    documents.push(...pageDocuments);
    if (pageDocuments.length < 500) return documents;
    after = pageDocuments[pageDocuments.length - 1]?.name;
    if (!after) return documents;
  }
  jsonError(503, 'APP_USER_CLEANUP_LIMIT', 'Account data exceeds the safe cleanup limit. Contact the platform administrator.');
}

function firestoreField(document: FirestoreDocument, key: string) {
  const value = document.fields?.[key];
  return value ? decodeFirestoreValue(value) : undefined;
}

async function commitFirestoreWrites(env: WorkspaceEnv, token: string, writes: Array<Record<string, unknown>>, stage: 'metadata_updates' | 'document_deletes') {
  for (let offset = 0; offset < writes.length; offset += 450) {
    const result = await fetch(`${firestoreBase(env)}:commit`, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ writes: writes.slice(offset, offset + 450) }),
    });
    if (!result.ok) {
      const body = await result.json().catch(() => null) as { error?: { status?: string; code?: number; message?: string } } | null;
      const upstreamCode = body?.error?.status || `HTTP_${result.status}`;
      const safeUpstreamMessage = (body?.error?.message || '')
        .replace(/projects\/[^/\s]+\/databases\/[^/\s]+\/documents\/[^\s"',)]+/g, '<document>')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
        .slice(0, 240);
      console.error('App user Firestore cleanup commit failed', result.status, upstreamCode, stage, safeUpstreamMessage);
      jsonError(502, 'APP_USER_CLEANUP_FAILED', 'Firestore could not finish cleaning this account. Firebase Auth may already be revoked; retry is safe. The Workspace mailbox and stored PDF files were not changed.', {
        firebaseStatus: result.status,
        firebaseCode: upstreamCode,
        firebaseMessage: safeUpstreamMessage || null,
        cleanupStage: stage,
      });
    }
  }
}

async function deleteFirestoreDocuments(env: WorkspaceEnv, token: string, documents: FirestoreDocument[]) {
  const apiPrefix = 'https://firestore.googleapis.com/v1/';
  await commitFirestoreWrites(env, token, documents.map(({ name }) => ({
    delete: name.startsWith(apiPrefix) ? name.slice(apiPrefix.length) : name,
  })), 'document_deletes');
}

async function deleteFirebaseAuthUser(env: WorkspaceEnv, token: string, uid: string) {
  const result = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:delete`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ localId: uid }),
  });
  const body = await result.json().catch(() => null) as { error?: { message?: string } } | null;
  if (result.ok || body?.error?.message === 'USER_NOT_FOUND') return;
  console.error('Firebase Auth account deletion failed', result.status, body?.error?.message || 'unknown');
  if (result.status === 401 || result.status === 403) {
    jsonError(503, 'FIREBASE_DELETE_PERMISSION_REQUIRED', 'The Worker service account needs Firebase Authentication user deletion permission before this account can be deleted.');
  }
  jsonError(502, 'FIREBASE_DELETE_FAILED', 'Could not revoke this Firebase account. No application data was deleted.');
}

async function deleteApplicationUser(uid: string, request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'appUser.delete', env);
  await rateLimit(env, identity.uid, 'app-user-delete', 10, 600);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) jsonError(400, 'VALIDATION_ERROR', 'Invalid application user identifier.');
  if (uid === identity.uid) jsonError(403, 'CANNOT_DELETE_SELF', 'You cannot delete your own administrator account.');
  const input = await parseJson(request);
  const serviceToken = await createFirebaseServiceAccessToken(env, 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit');
  const profileResult = await fetch(`${firestoreBase(env)}/userProfiles/${encodeURIComponent(uid)}`, {
    headers: { authorization: `Bearer ${serviceToken}` }, signal: AbortSignal.timeout(10000),
  });
  if (profileResult.status === 404) jsonError(404, 'APP_USER_NOT_FOUND', 'The application profile was not found.');
  if (!profileResult.ok) jsonError(502, 'FIRESTORE_UNAVAILABLE', 'Could not verify the target application profile.');
  const profileDocument = await profileResult.json() as FirestoreDocument;
  const email = String(firestoreField(profileDocument, 'email') || '').trim().toLowerCase();
  const role = firestoreField(profileDocument, 'role');
  if (!email || input.confirmEmail !== email) jsonError(400, 'DELETE_CONFIRMATION_REQUIRED', 'confirmEmail must exactly match the application account email.');
  if (role === 'ADMIN') {
    const admins = await listFirestoreByField(env, serviceToken, 'userProfiles', 'role', 'ADMIN');
    const activeAdmins = admins.filter((document) => firestoreField(document, 'isActive') === true
      && !['SUSPENDED', 'REJECTED'].includes(String(firestoreField(document, 'status') || '')));
    if (activeAdmins.length <= 1) jsonError(409, 'LAST_ACTIVE_ADMIN', 'The last active administrator cannot be deleted.');
  }

  await audit(env, identity.uid, 'APP_USER_DELETED', 'STARTED', uid, email);

  const ownedPublications = await listFirestoreByField(env, serviceToken, 'publications', 'uploaderId', uid);
  const deleteDocs: FirestoreDocument[] = [];
  const removeWrites: Array<Record<string, unknown>> = [];
  for (const publication of ownedPublications) {
    const publicationId = publication.name.split('/').pop() || '';
    const [authorLinks, versions, reviews, events] = await Promise.all([
      listFirestoreByField(env, serviceToken, 'publicationAuthors', 'publicationId', publicationId),
      listFirestoreByField(env, serviceToken, 'publicationVersions', 'publicationId', publicationId),
      listFirestoreByField(env, serviceToken, 'publicationReviews', 'publicationId', publicationId),
      listFirestoreByField(env, serviceToken, 'publicationEvents', 'publicationId', publicationId),
    ]);
    const otherAuthors = authorLinks.filter((link) => firestoreField(link, 'userId') !== uid);
    if (otherAuthors.length) {
      removeWrites.push({ update: { name: publication.name, fields: {} }, updateMask: { fieldPaths: ['uploaderId'] } });
      deleteDocs.push(...authorLinks.filter((link) => firestoreField(link, 'userId') === uid));
      deleteDocs.push(...reviews.filter((review) => firestoreField(review, 'reviewerId') === uid));
      deleteDocs.push(...events.filter((event) => firestoreField(event, 'actorId') === uid));
    } else {
      deleteDocs.push(publication, ...authorLinks, ...versions, ...reviews, ...events);
      for (const version of versions) {
        const versionId = version.name.split('/').pop() || '';
        const versionAuthors = await listFirestoreByField(env, serviceToken, 'publicationVersionAuthors', 'publicationVersionId', versionId);
        deleteDocs.push(...versionAuthors);
      }
    }
  }

  const [userReviews, userEvents, userAuthorLinks, userVersionAuthorLinks, authoredRecords, notifications, createdVersions] = await Promise.all([
    listFirestoreByField(env, serviceToken, 'publicationReviews', 'reviewerId', uid),
    listFirestoreByField(env, serviceToken, 'publicationEvents', 'actorId', uid),
    listFirestoreByField(env, serviceToken, 'publicationAuthors', 'userId', uid),
    listFirestoreByField(env, serviceToken, 'publicationVersionAuthors', 'userId', uid),
    listFirestoreByField(env, serviceToken, 'authors', 'userId', uid),
    listFirestoreByField(env, serviceToken, 'notifications', 'userId', uid),
    listFirestoreByField(env, serviceToken, 'publicationVersions', 'createdById', uid),
  ]);
  deleteDocs.push(...userReviews, ...userEvents, ...userAuthorLinks, ...userVersionAuthorLinks, ...authoredRecords, ...notifications);
  const deletedNames = new Set(deleteDocs.map(({ name }) => name));
  for (const version of createdVersions) {
    if (!deletedNames.has(version.name)) removeWrites.push({ update: { name: version.name, fields: {} }, updateMask: { fieldPaths: ['createdById'] } });
  }
  // Check the Firebase Auth deletion permission before Firestore records are removed.
  // Later cleanup remains retryable because the app profile is retained until the end.
  await deleteFirebaseAuthUser(env, serviceToken, uid);
  await commitFirestoreWrites(env, serviceToken, removeWrites, 'metadata_updates');
  await deleteFirestoreDocuments(env, serviceToken, [...new Map(deleteDocs.map((document) => [document.name, document])).values()]);
  await env.DB.prepare('DELETE FROM workspace_identity_links WHERE profile_uid = ?').bind(uid).run();
  await env.DB.prepare('DELETE FROM app_user_pending_credentials WHERE profile_uid = ?').bind(uid).run();
  await env.DB.prepare('DELETE FROM app_user_logins WHERE profile_uid = ?').bind(uid).run();
  await deleteFirestoreDocuments(env, serviceToken, [
    { name: `${firestoreBase(env)}/registrationRequests/${encodeURIComponent(uid)}` },
    { name: `${firestoreBase(env)}/users/${encodeURIComponent(uid)}` },
    { name: `${firestoreBase(env)}/userProfiles/${encodeURIComponent(uid)}` },
    { name: `${firestoreBase(env)}/sessions/${encodeURIComponent(uid)}` },
    { name: `${firestoreBase(env)}/passwordResetTokens/${encodeURIComponent(uid)}` },
    { name: `${firestoreBase(env)}/registrationAttempts/${encodeURIComponent(uid)}` },
  ]);
  await audit(env, identity.uid, 'APP_USER_DELETED', 'SUCCESS', uid, email);
  return response({ uid, email, workspaceMailboxPreserved: true, storedFilesPreserved: true }, 'Firebase account and application data deleted; Workspace mailbox and stored files preserved.');
}

const ssoScopes = new Set(['email', 'profile', 'hyperdatalab_profile']);

type SsoClientRow = {
  client_id: string; client_secret_hash: string | null; name: string; description: string | null;
  client_type: 'PUBLIC' | 'CONFIDENTIAL'; redirect_uris_json: string; allowed_scopes_json: string;
  is_active: number; created_at: string; updated_at: string;
};

function ssoClientDto(client: SsoClientRow) {
  return {
    clientId: client.client_id, name: client.name, description: client.description,
    clientType: client.client_type, redirectUris: JSON.parse(client.redirect_uris_json) as string[],
    allowedScopes: JSON.parse(client.allowed_scopes_json) as string[], isActive: client.is_active === 1,
    createdAt: client.created_at, updatedAt: client.updated_at,
  };
}

function validateSsoRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) jsonError(400, 'VALIDATION_ERROR', 'Add between 1 and 20 exact callback URLs.');
  const uris = [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : ''))];
  for (const value of uris) {
    if (!value || value.includes('*')) jsonError(400, 'VALIDATION_ERROR', 'Callback URLs must be exact URLs.');
    let url: URL;
    try { url = new URL(value); } catch { jsonError(400, 'VALIDATION_ERROR', 'A callback URL is invalid.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.hash || url.username || url.password || (url.protocol !== 'https:' && !local)) jsonError(400, 'VALIDATION_ERROR', 'Callback URLs must use HTTPS except on localhost.');
  }
  return uris;
}

async function listSsoClients(env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'workspace.oauth.manage', env);
  const result = await env.DB.prepare('SELECT * FROM sso_clients ORDER BY created_at DESC').all<SsoClientRow>();
  return response({ clients: (result.results || []).map(ssoClientDto) });
}

async function createSsoClient(request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'workspace.oauth.manage', env);
  const input = await parseJson(request);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 2 || name.length > 100) jsonError(400, 'VALIDATION_ERROR', 'Client name must contain 2–100 characters.');
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 500) : null;
  const redirectUris = validateSsoRedirectUris(input.redirectUris);
  if (!['PUBLIC', 'CONFIDENTIAL'].includes(String(input.clientType))) jsonError(400, 'VALIDATION_ERROR', 'Choose PUBLIC or CONFIDENTIAL client type.');
  const clientType = input.clientType as 'PUBLIC' | 'CONFIDENTIAL';
  const scopes = Array.isArray(input.allowedScopes) ? [...new Set(input.allowedScopes.filter((scope): scope is string => typeof scope === 'string'))] : ['email', 'profile'];
  if (!scopes.length || scopes.some((scope) => !ssoScopes.has(scope))) jsonError(400, 'VALIDATION_ERROR', 'One or more profile scopes are unsupported.');
  const clientId = `hd_${randomToken(18)}`;
  const clientSecret = clientType === 'CONFIDENTIAL' ? `hds_${randomToken(32)}` : null;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO sso_clients (client_id, client_secret_hash, name, description, client_type, redirect_uris_json, allowed_scopes_json, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(clientId, clientSecret ? await sha256(clientSecret) : null, name, description, clientType, JSON.stringify(redirectUris), JSON.stringify(scopes), now, now).run();
  await audit(env, identity.uid, 'SSO_CLIENT_CREATED', 'SUCCESS', clientId, clientType);
  return response({ client: {
    clientId, clientSecret, name, description, clientType, redirectUris, allowedScopes: scopes,
    isActive: true, createdAt: now, updatedAt: now,
  } }, 'Client registered. Save the secret now; it is only shown once.', 201);
}

async function setSsoClientActive(clientId: string, request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'workspace.oauth.manage', env);
  if (!/^hd_[A-Za-z0-9_-]{20,40}$/.test(clientId)) jsonError(404, 'SSO_CLIENT_NOT_FOUND', 'Client was not found.');
  const input = await parseJson(request);
  if (typeof input.isActive !== 'boolean') jsonError(400, 'VALIDATION_ERROR', 'isActive must be true or false.');
  const now = new Date().toISOString();
  const result = await env.DB.prepare('UPDATE sso_clients SET is_active = ?, updated_at = ? WHERE client_id = ?')
    .bind(input.isActive ? 1 : 0, now, clientId).run();
  if (result.meta?.changes !== 1) jsonError(404, 'SSO_CLIENT_NOT_FOUND', 'Client was not found.');
  await audit(env, identity.uid, input.isActive ? 'SSO_CLIENT_ENABLED' : 'SSO_CLIENT_DISABLED', 'SUCCESS', clientId);
  return response({ clientId, isActive: input.isActive });
}

async function deleteSsoClient(clientId: string, env: WorkspaceEnv, identity: WorkspaceIdentity) {
  await authorize(identity, 'workspace.oauth.manage', env);
  if (!/^hd_[A-Za-z0-9_-]{20,40}$/.test(clientId)) jsonError(404, 'SSO_CLIENT_NOT_FOUND', 'Client was not found.');
  const client = await env.DB.prepare('SELECT name FROM sso_clients WHERE client_id = ?').bind(clientId).first<{ name: string }>();
  if (!client) jsonError(404, 'SSO_CLIENT_NOT_FOUND', 'Client was not found.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sso_authorization_requests WHERE client_id = ?').bind(clientId),
    env.DB.prepare('DELETE FROM sso_authorization_codes WHERE client_id = ?').bind(clientId),
    env.DB.prepare('DELETE FROM sso_access_tokens WHERE client_id = ?').bind(clientId),
    env.DB.prepare('DELETE FROM sso_clients WHERE client_id = ?').bind(clientId),
  ]);
  await audit(env, identity.uid, 'SSO_CLIENT_DELETED', 'SUCCESS', clientId, client.name);
  return response({ clientId, deleted: true }, 'SSO client deleted and issued tokens revoked.');
}

function ssoLoginRedirect(env: WorkspaceEnv, requestId: string) {
  const allowed = (env.ALLOWED_ORIGINS || env.FRONTEND_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  const target = new URL('/login', env.FRONTEND_URL);
  if (!allowed.includes(target.origin)) jsonError(503, 'FRONTEND_NOT_CONFIGURED', 'The login frontend is not allowlisted.');
  target.searchParams.set('sso_request', requestId);
  return Response.redirect(target.toString(), 302);
}

async function beginSsoAuthorization(request: Request, env: WorkspaceEnv) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const state = url.searchParams.get('state') || '';
  const challenge = url.searchParams.get('code_challenge') || '';
  const scopes = (url.searchParams.get('scope') || '').split(/\s+/).filter(Boolean);
  if (url.searchParams.get('response_type') !== 'code' || !clientId || !state || state.length > 512
    || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || url.searchParams.get('code_challenge_method') !== 'S256') {
    jsonError(400, 'INVALID_AUTHORIZATION_REQUEST', 'Use authorization code flow with state and PKCE S256.');
  }
  const client = await env.DB.prepare('SELECT * FROM sso_clients WHERE client_id = ? AND is_active = 1').bind(clientId).first<SsoClientRow>();
  if (!client || !(JSON.parse(client.redirect_uris_json) as string[]).includes(redirectUri)) jsonError(400, 'INVALID_CLIENT_OR_REDIRECT_URI', 'Client or exact callback URL is not registered.');
  const allowedScopes = JSON.parse(client.allowed_scopes_json) as string[];
  if (!scopes.length || scopes.some((scope) => !allowedScopes.includes(scope) || !ssoScopes.has(scope))) jsonError(400, 'INVALID_SCOPE', 'The client did not request an allowed profile scope.');
  const requestId = randomToken(24);
  const now = new Date().toISOString();
  await env.DB.prepare('DELETE FROM sso_authorization_requests WHERE expires_at <= ? OR consumed_at IS NOT NULL').bind(now).run();
  await env.DB.prepare('DELETE FROM sso_authorization_codes WHERE expires_at <= ? OR consumed_at IS NOT NULL').bind(now).run();
  await env.DB.prepare(`INSERT INTO sso_authorization_requests
    (request_id, client_id, redirect_uri, state, code_challenge, scopes_json, expires_at, consumed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
    .bind(requestId, clientId, redirectUri, state, challenge, JSON.stringify(scopes), new Date(Date.now() + 10 * 60 * 1000).toISOString(), now).run();
  return ssoLoginRedirect(env, requestId);
}

async function completeSsoAuthorization(request: Request, env: WorkspaceEnv, identity: WorkspaceIdentity, firebaseToken: string, requestId: string) {
  if (!/^[A-Za-z0-9_-]{24,40}$/.test(requestId)) jsonError(400, 'INVALID_AUTHORIZATION_REQUEST', 'SSO request is invalid or expired.');
  const profileApplication = await loadRegistrationApplication(env, firebaseToken, identity.uid);
  const profile = profileApplication.values;
  const workspaceEmail = typeof profile.workspaceEmail === 'string' ? profile.workspaceEmail.trim().toLowerCase() : '';
  if (!profileApplication.profileExists || profile.status !== 'APPROVED' || profile.isActive !== true
    || !['ADMIN', 'LECTURER', 'STUDENT'].includes(String(profile.role))
    || workspaceEmail.split('@')[1] !== configuredDomain(env)) {
    jsonError(403, 'PROFILE_NOT_APPROVED', 'Only an approved, active Workspace profile can use SSO.');
  }
  const requestRow = await env.DB.prepare(`SELECT r.*, c.redirect_uris_json, c.is_active FROM sso_authorization_requests r
    JOIN sso_clients c ON c.client_id = r.client_id
    WHERE r.request_id = ? AND r.expires_at > ? AND r.consumed_at IS NULL`)
    .bind(requestId, new Date().toISOString()).first<{
      request_id: string; client_id: string; redirect_uri: string; state: string; code_challenge: string;
      scopes_json: string; redirect_uris_json: string; is_active: number;
    }>();
  if (!requestRow || requestRow.is_active !== 1 || !(JSON.parse(requestRow.redirect_uris_json) as string[]).includes(requestRow.redirect_uri)) {
    jsonError(400, 'INVALID_AUTHORIZATION_REQUEST', 'SSO request is invalid or expired.');
  }
  const consumed = await env.DB.prepare('UPDATE sso_authorization_requests SET consumed_at = ? WHERE request_id = ? AND consumed_at IS NULL AND expires_at > ?')
    .bind(new Date().toISOString(), requestId, new Date().toISOString()).run();
  if (consumed.meta?.changes !== 1) jsonError(400, 'INVALID_AUTHORIZATION_REQUEST', 'SSO request was already used. Start again from the application.');
  const code = randomToken(32);
  const createdAt = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO sso_authorization_codes
    (code_hash, client_id, profile_uid, redirect_uri, code_challenge, scopes_json, expires_at, consumed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
    .bind(await sha256(code), requestRow.client_id, identity.uid, requestRow.redirect_uri, requestRow.code_challenge,
      requestRow.scopes_json, new Date(Date.now() + 2 * 60 * 1000).toISOString(), createdAt).run();
  const callback = new URL(requestRow.redirect_uri);
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', requestRow.state);
  return response({ redirectUrl: callback.toString() }, 'SSO authorization completed.');
}

async function parseOAuthBody(request: Request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(await request.text()).entries());
  return parseJson(request);
}

async function validateSsoClientSecret(client: SsoClientRow, secret: unknown) {
  if (client.client_type === 'PUBLIC') return secret == null || secret === '';
  if (typeof secret !== 'string' || !client.client_secret_hash) return false;
  const actual = await sha256(secret);
  if (actual.length !== client.client_secret_hash.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ client.client_secret_hash.charCodeAt(index);
  return difference === 0;
}

async function exchangeSsoCode(request: Request, env: WorkspaceEnv) {
  const input = await parseOAuthBody(request);
  if (input.grant_type !== 'authorization_code') jsonError(400, 'UNSUPPORTED_GRANT_TYPE', 'Only authorization_code is supported.');
  let basicCredentials: { clientId: string; clientSecret: string } | null = null;
  const authorization = request.headers.get('authorization') || '';
  const basic = authorization.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i)?.[1];
  if (basic) {
    try {
      const decoded = atob(basic);
      const separator = decoded.indexOf(':');
      if (separator > 0) basicCredentials = { clientId: decodeURIComponent(decoded.slice(0, separator)), clientSecret: decodeURIComponent(decoded.slice(separator + 1)) };
    } catch { /* Invalid HTTP Basic credentials are handled as invalid client credentials below. */ }
  }
  const clientId = typeof input.client_id === 'string' ? input.client_id : basicCredentials?.clientId || '';
  const client = await env.DB.prepare('SELECT * FROM sso_clients WHERE client_id = ? AND is_active = 1').bind(clientId).first<SsoClientRow>();
  const clientSecret = typeof input.client_secret === 'string' ? input.client_secret : basicCredentials?.clientSecret;
  if (!client || !await validateSsoClientSecret(client, clientSecret)) jsonError(401, 'INVALID_CLIENT', 'Client credentials are invalid.');
  const code = typeof input.code === 'string' ? input.code : '';
  const redirectUri = typeof input.redirect_uri === 'string' ? input.redirect_uri : '';
  const verifier = typeof input.code_verifier === 'string' ? input.code_verifier : '';
  if (!code || !redirectUri || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) jsonError(400, 'INVALID_REQUEST', 'Authorization code, redirect_uri, and PKCE verifier are required.');
  const hash = await sha256(code);
  const record = await env.DB.prepare('SELECT * FROM sso_authorization_codes WHERE code_hash = ? AND client_id = ? AND expires_at > ? AND consumed_at IS NULL')
    .bind(hash, clientId, new Date().toISOString()).first<{
      code_hash: string; client_id: string; profile_uid: string; redirect_uri: string; code_challenge: string; scopes_json: string;
    }>();
  if (!record || record.redirect_uri !== redirectUri || await createPkceChallenge(verifier) !== record.code_challenge) jsonError(400, 'INVALID_GRANT', 'The authorization code, callback URL, or PKCE verifier is invalid.');
  const consumed = await env.DB.prepare('UPDATE sso_authorization_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?')
    .bind(new Date().toISOString(), hash, new Date().toISOString()).run();
  if (consumed.meta?.changes !== 1) jsonError(400, 'INVALID_GRANT', 'Authorization code was already used.');
  const token = randomToken(40);
  const now = new Date().toISOString();
  await env.DB.prepare('DELETE FROM sso_access_tokens WHERE expires_at <= ? OR revoked_at IS NOT NULL').bind(now).run();
  await env.DB.prepare('INSERT INTO sso_access_tokens (token_hash, client_id, profile_uid, scopes_json, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)')
    .bind(await sha256(token), clientId, record.profile_uid, record.scopes_json, new Date(Date.now() + 60 * 60 * 1000).toISOString(), now).run();
  return Response.json({ access_token: token, token_type: 'Bearer', expires_in: 3600, scope: (JSON.parse(record.scopes_json) as string[]).join(' ') }, { headers: { 'cache-control': 'no-store' } });
}

async function ssoUserInfo(request: Request, env: WorkspaceEnv) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!token) jsonError(401, 'INVALID_TOKEN', 'A bearer access token is required.');
  const tokenRecord = await env.DB.prepare(`SELECT t.*, c.is_active FROM sso_access_tokens t JOIN sso_clients c ON c.client_id = t.client_id
    WHERE t.token_hash = ? AND t.expires_at > ? AND t.revoked_at IS NULL`)
    .bind(await sha256(token), new Date().toISOString()).first<{ profile_uid: string; scopes_json: string; is_active: number }>();
  if (!tokenRecord || tokenRecord.is_active !== 1) jsonError(401, 'INVALID_TOKEN', 'Access token is invalid or expired.');
  const serviceToken = await createFirebaseServiceAccessToken(env, 'https://www.googleapis.com/auth/datastore');
  const profileResponse = await fetch(`${firestoreBase(env)}/userProfiles/${encodeURIComponent(tokenRecord.profile_uid)}`, {
    headers: { authorization: `Bearer ${serviceToken}` }, signal: AbortSignal.timeout(8000),
  });
  if (!profileResponse.ok) jsonError(401, 'PROFILE_NOT_APPROVED', 'The application profile is unavailable or no longer active.');
  const document = await profileResponse.json() as FirestoreDocument;
  const profile = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)])) as Record<string, unknown>;
  const email = typeof profile.workspaceEmail === 'string' ? profile.workspaceEmail.trim().toLowerCase() : '';
  if (profile.status !== 'APPROVED' || profile.isActive !== true || email.split('@')[1] !== configuredDomain(env)) {
    jsonError(401, 'PROFILE_NOT_APPROVED', 'The application profile is unavailable or no longer active.');
  }
  const scopes = new Set(JSON.parse(tokenRecord.scopes_json) as string[]);
  const name = typeof profile.name === 'string' ? profile.name : [profile.firstName, profile.lastName].filter((part) => typeof part === 'string' && part).join(' ');
  return Response.json({
    sub: tokenRecord.profile_uid,
    ...(scopes.has('email') ? { email, email_verified: true } : {}),
    ...(scopes.has('profile') ? { name, picture: profile.avatarUrl || profile.photoURL || null } : {}),
    ...(scopes.has('hyperdatalab_profile') ? {
      role: profile.role, student_id: profile.studentId || null, major: profile.major || null,
    } : {}),
  }, { headers: { 'cache-control': 'no-store' } });
}

async function revokeSsoToken(request: Request, env: WorkspaceEnv) {
  const input = await parseOAuthBody(request);
  const token = typeof input.token === 'string' ? input.token : '';
  if (token) await env.DB.prepare('UPDATE sso_access_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), await sha256(token)).run();
  return Response.json({}, { headers: { 'cache-control': 'no-store' } });
}

export async function handleWorkspaceRequest(request: Request, env: WorkspaceEnv, identity?: WorkspaceIdentity, firebaseToken = ''): Promise<Response | null> {
  const url = new URL(request.url);
  try {
    if (url.pathname === '/oauth/authorize' && request.method === 'GET') return await beginSsoAuthorization(request, env);
    if (url.pathname === '/oauth/token' && request.method === 'POST') return await exchangeSsoCode(request, env);
    if (url.pathname === '/oauth/userinfo' && request.method === 'GET') return await ssoUserInfo(request, env);
    if (url.pathname === '/oauth/revoke' && request.method === 'POST') return await revokeSsoToken(request, env);
    if (url.pathname.startsWith('/oauth/')) jsonError(404, 'NOT_FOUND', 'SSO OAuth endpoint was not found.');
    if (!env.DB || typeof env.DB.prepare !== 'function') jsonError(503, 'WORKSPACE_NOT_CONFIGURED', 'Workspace storage is not configured on this Worker.');
    if (url.pathname === '/auth/username-login' && request.method === 'POST') return await usernameLogin(request, env);
    if (url.pathname === '/api/sso/authorize/complete' && request.method === 'POST' && identity) {
      const input = await parseJson(request);
      const requestId = typeof input.requestId === 'string' ? input.requestId : '';
      return await completeSsoAuthorization(request, env, identity, firebaseToken, requestId);
    }
    if (url.pathname === '/api/sso/clients' && request.method === 'GET' && identity) return await listSsoClients(env, identity);
    if (url.pathname === '/api/sso/clients' && request.method === 'POST' && identity) return await createSsoClient(request, env, identity);
    const ssoClientMatch = url.pathname.match(/^\/api\/sso\/clients\/([^/]+)$/);
    if (ssoClientMatch && request.method === 'DELETE' && identity) return await deleteSsoClient(decodeURIComponent(ssoClientMatch[1]), env, identity);
    if (ssoClientMatch && request.method === 'PATCH' && identity) return await setSsoClientActive(decodeURIComponent(ssoClientMatch[1]), request, env, identity);
    if (url.pathname.startsWith('/api/sso/')) jsonError(identity ? 404 : 401, identity ? 'NOT_FOUND' : 'UNAUTHENTICATED', identity ? 'SSO API endpoint was not found.' : 'An approved Firebase account is required.');
    if (url.pathname === '/auth/google/callback' && request.method === 'GET') return await callback(request, env);
    if (url.pathname === '/auth/workspace/exchange' && request.method === 'POST' && identity) return await exchangeWorkspaceLogin(env, identity);
    if (!identity) jsonError(401, 'UNAUTHENTICATED', 'Firebase authentication is required.');
    if (url.pathname === '/auth/google/start' && request.method === 'POST') return await startOAuth(request, env, identity);
    if (url.pathname === '/auth/google/status' && request.method === 'GET') {
      await authorize(identity, 'workspace.read', env);
      return await connectionStatus(env);
    }
    if (url.pathname === '/auth/google/disconnect' && request.method === 'POST') return await disconnect(env, identity);
    const registrationMatch = url.pathname.match(/^\/api\/workspace\/registrations\/([^/]+)\/(approve|resend)$/);
    if (registrationMatch && request.method === 'POST') {
      const profileUid = decodeURIComponent(registrationMatch[1]);
      if (registrationMatch[2] === 'approve') return await approveRegistration(request, env, identity, firebaseToken);
      return await resendWorkspaceOnboarding(request, env, identity, firebaseToken, profileUid);
    }
    if (url.pathname === '/api/workspace/profiles' && request.method === 'POST') {
      return await createLinkedWorkspaceProfile(request, env, identity, firebaseToken);
    }
    if (url.pathname === '/api/workspace/app-users' && request.method === 'POST') return await createApplicationUser(request, env, identity);
    const appUserResendMatch = url.pathname.match(/^\/api\/workspace\/app-users\/([^/]+)\/resend-credentials$/);
    if (appUserResendMatch && request.method === 'POST') return await resendAppUserCredentials(decodeURIComponent(appUserResendMatch[1]), env, identity);
    const appUserMatch = url.pathname.match(/^\/api\/workspace\/app-users\/([^/]+)$/);
    if (appUserMatch && request.method === 'DELETE') return await deleteApplicationUser(decodeURIComponent(appUserMatch[1]), request, env, identity);
    if (!url.pathname.startsWith('/api/workspace/users')) return null;
    if (url.pathname === '/api/workspace/users' && request.method === 'GET') {
      await authorize(identity, 'workspace.read', env);
      return await listUsers(request, env);
    }
    if (url.pathname === '/api/workspace/users' && request.method === 'POST') return await createUser(request, env, identity);
    const match = url.pathname.match(/^\/api\/workspace\/users\/([^/]+)(?:\/(suspend|restore))?$/);
    if (!match) jsonError(404, 'NOT_FOUND', 'Workspace endpoint was not found.');
    const id = decodeURIComponent(match[1]);
    if (!match[2] && request.method === 'GET') {
      await authorize(identity, 'workspace.read', env);
      return await getUser(id, env);
    }
    if (!match[2] && request.method === 'PATCH') return await updateUser(id, request, env, identity);
    if (match[2] && request.method === 'PATCH') return await setSuspended(id, match[2] === 'suspend', env, identity, firebaseToken);
    if (!match[2] && request.method === 'DELETE') return await deleteUser(id, request, env, identity);
    jsonError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error('Workspace API request failed', error instanceof Error ? error.message : 'unknown');
    return errorResponse(new ApiError(500, 'INTERNAL_ERROR', 'The request could not be completed.'));
  }
}

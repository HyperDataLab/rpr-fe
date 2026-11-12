import { describe, expect, it, vi } from 'vitest';
import { encryptSecret, sha256 } from './crypto';
import { consumeOAuthTransaction, handleWorkspaceRequest } from './index';
import type { D1Database, D1Result, D1Statement, WorkspaceEnv } from './types';

class TestStatement implements D1Statement {
  values: unknown[] = [];
  constructor(private readonly sql: string, private readonly db: TestDatabase) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (this.sql.includes('oauth_transactions SET consumed_at')) {
      if (this.db.consumed) return { success: true, meta: { changes: 0 } };
      this.db.consumed = true;
    }
    return { success: true, meta: { changes: 1 } };
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> { return { success: true, results: [] }; }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (this.sql.includes('SELECT request_count')) return { request_count: 1 } as T;
    if (this.sql.includes('SELECT name FROM sso_clients')) return { name: 'Test client' } as T;
    if (this.sql.includes('SELECT * FROM google_oauth_connections')) return this.db.connection as T | null;
    if (this.sql.includes('SELECT * FROM oauth_transactions')) {
      const [id, stateHash] = this.values;
      if (this.db.consumed || this.db.transaction?.id !== id || this.db.transaction?.state_hash !== stateHash) return null;
      return this.db.transaction as T;
    }
    return null;
  }
}

class TestDatabase implements D1Database {
  consumed = false;
  connection: Record<string, unknown> | null = null;
  transaction: Record<string, unknown> | null = null;
  prepare(sql: string) { return new TestStatement(sql, this); }
  async batch<T = unknown>(): Promise<D1Result<T>[]> { return []; }
}

async function testEnv() {
  const db = new TestDatabase();
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key = btoa(String.fromCharCode(...rawKey));
  const env = {
    DB: db, FIREBASE_PROJECT_ID: 'test-project', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:8787/auth/google/callback', GOOGLE_WORKSPACE_DOMAIN: 'example.org',
    GOOGLE_ADMIN_EMAILS: 'admin@example.org', TOKEN_ENCRYPTION_KEYS: JSON.stringify({ v1: key }), TOKEN_ENCRYPTION_KEY_VERSION: 'v1',
    FRONTEND_URL: 'http://localhost:3003', ALLOWED_ORIGINS: 'http://localhost:3003', WORKSPACE_DELETE_ENABLED: 'false',
  } as unknown as WorkspaceEnv;
  const cipher = await encryptSecret(env, 'refresh-token', 'workspace-refresh:primary:admin@example.org');
  db.connection = { id: 'primary', workspace_domain: 'example.org', admin_email: 'admin@example.org', admin_subject: 'google-sub', connected_by_uid: 'firebase-admin',
    refresh_token_ciphertext: cipher.ciphertext, refresh_token_nonce: cipher.nonce, token_key_version: cipher.keyVersion,
    granted_scopes: '[]', status: 'CONNECTED', connected_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  return { env, db };
}

const admin = { uid: 'firebase-admin', role: 'ADMIN' as const };
const student = { uid: 'firebase-student', role: 'STUDENT' as const };

describe('Workspace API authorization and validation', () => {
  it('rejects malformed SSO authorization requests before creating a login request', async () => {
    const { env } = await testEnv();
    const result = await handleWorkspaceRequest(new Request('https://worker.test/oauth/authorize?response_type=code'), env);
    expect(result?.status).toBe(400);
    expect(await result?.json()).toMatchObject({ success: false, error: { code: 'INVALID_AUTHORIZATION_REQUEST' } });
  });

  it('restricts SSO client management to administrators', async () => {
    const { env } = await testEnv();
    const result = await handleWorkspaceRequest(new Request('https://worker.test/api/sso/clients', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Client' }),
    }), env, student);
    expect(result?.status).toBe(403);
    expect(await result?.json()).toMatchObject({ success: false, error: { code: 'WORKSPACE_PERMISSION_DENIED' } });
  });

  it('routes DELETE requests for SSO clients to client deletion', async () => {
    const { env } = await testEnv();
    const clientId = `hd_${'a'.repeat(24)}`;
    const result = await handleWorkspaceRequest(new Request(`https://worker.test/api/sso/clients/${clientId}`, { method: 'DELETE' }), env, admin);
    expect(result?.status).toBe(200);
    expect(await result?.json()).toMatchObject({ success: true, data: { clientId, deleted: true } });
  });

  it('does not complete SSO for a pending application profile', async () => {
    const { env } = await testEnv();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ fields: {
      workspaceEmail: { stringValue: 'student@example.org' }, status: { stringValue: 'PENDING' },
      isActive: { booleanValue: true }, role: { stringValue: 'STUDENT' },
    } })));
    const result = await handleWorkspaceRequest(new Request('https://worker.test/api/sso/authorize/complete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'A'.repeat(24) }),
    }), env, student, 'firebase-id-token');
    expect(result?.status).toBe(403);
    expect(await result?.json()).toMatchObject({ success: false, error: { code: 'PROFILE_NOT_APPROVED' } });
    vi.unstubAllGlobals();
  });

  it('rejects unknown SSO OAuth endpoints instead of falling through to the app API', async () => {
    const { env } = await testEnv();
    const result = await handleWorkspaceRequest(new Request('https://worker.test/oauth/unknown'), env);
    expect(result?.status).toBe(404);
  });

  it('rejects non-admin users before Google API calls', async () => {
    const { env } = await testEnv();
    const result = await handleWorkspaceRequest(new Request('https://worker.test/api/workspace/users', { method: 'POST', body: '{}' }), env, student);
    expect(result?.status).toBe(403);
    expect(await result?.json()).toMatchObject({ success: false, error: { code: 'WORKSPACE_PERMISSION_DENIED' } });
  });

  it('rejects a target outside the configured Workspace domain', async () => {
    const { env } = await testEnv();
    const result = await handleWorkspaceRequest(new Request('https://worker.test/api/workspace/users', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'person@outside.org', firstName: 'First', lastName: 'Last', password: 'StrongTemporaryPassword123!' }),
    }), env, admin);
    expect(result?.status).toBe(400);
    expect(await result?.json()).toMatchObject({ success: false, error: { code: 'WORKSPACE_DOMAIN_RESTRICTED' } });
  });

  it('rejects mass-assignment fields and client-supplied passwords', async () => {
    const { env } = await testEnv();
    const patch = await handleWorkspaceRequest(new Request('https://worker.test/api/workspace/users/id', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'SUPER_ADMIN' }),
    }), env, admin);
    expect(patch?.status).toBe(400);
    const create = await handleWorkspaceRequest(new Request('https://worker.test/api/workspace/users', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'user@example.org', firstName: 'A', lastName: 'B', password: 'weak' }),
    }), env, admin);
    expect(create?.status).toBe(400);
    expect(await create?.json()).toMatchObject({ success: false, error: { code: 'PASSWORD_MUST_BE_GENERATED' } });
  });

  it('maps duplicate Workspace users to HTTP 409 without retrying create', async () => {
    const { env } = await testEnv();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input) === 'https://oauth2.googleapis.com/token'
      ? Response.json({ access_token: 'ephemeral-access-token' })
      : Response.json({ error: { message: 'duplicate', errors: [{ reason: 'duplicate' }] } }, { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleWorkspaceRequest(new Request('https://worker.test/api/workspace/users', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'user@example.org', firstName: 'A', lastName: 'B' }),
    }), env, admin);
    expect(result?.status).toBe(409);
    expect(await result?.json()).toMatchObject({ success: false, error: { code: 'WORKSPACE_USER_EXISTS' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('lists a bounded page and forwards its pagination/sort parameters', async () => {
    const { env } = await testEnv();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'ephemeral-access-token' });
      expect(url).toContain('maxResults=1');
      expect(url).toContain('pageToken=next-page');
      expect(url).toContain('orderBy=givenName');
      return Response.json({ users: [{ id: 'u1', primaryEmail: 'u1@example.org', name: { givenName: 'A', familyName: 'B', fullName: 'A B' } }], nextPageToken: 'next-2' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleWorkspaceRequest(new Request('https://worker.test/api/workspace/users?pageSize=1&pageToken=next-page&orderBy=givenName&sortOrder=DESCENDING'), env, admin);
    expect(result?.status).toBe(200);
    expect(await result?.json()).toMatchObject({ success: true, data: { pageSize: 1, nextPageToken: 'next-2', users: [{ primaryEmail: 'u1@example.org' }] } });
    vi.unstubAllGlobals();
  });

  it.each([
    [401, 'WORKSPACE_CONNECTION_REVOKED'],
    [403, 'WORKSPACE_GOOGLE_PERMISSION_DENIED'],
    [429, 'WORKSPACE_RATE_LIMITED'],
    [503, 'GOOGLE_API_ERROR'],
  ])('normalizes Google API HTTP %i', async (status, code) => {
    const { env } = await testEnv();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === 'https://oauth2.googleapis.com/token'
      ? Response.json({ access_token: 'ephemeral-access-token' })
      : Response.json({ error: { message: 'upstream details' } }, { status })));
    const result = await handleWorkspaceRequest(new Request('https://worker.test/api/workspace/users/u1'), env, admin);
    expect(result?.status).toBe(status === 401 ? 503 : status === 503 ? 502 : status);
    expect(await result?.json()).toMatchObject({ success: false, error: { code } });
    vi.unstubAllGlobals();
  });

  it('does not issue D1/Google work or delete when delete remains disabled', async () => {
    const { env } = await testEnv();
    const result = await handleWorkspaceRequest(new Request('https://worker.test/api/workspace/users/u1', { method: 'DELETE', body: '{}' }), env, admin);
    expect(result?.status).toBe(403);
    expect(await result?.json()).toMatchObject({ success: false, error: { code: 'WORKSPACE_PERMISSION_DENIED' } });
  });

  it('accepts a matching OAuth state exactly once and rejects replay', async () => {
    const { env, db } = await testEnv();
    db.transaction = { id: 'tx-1', state_hash: await sha256('secret-state'), nonce: 'nonce', pkce_ciphertext: 'x', pkce_nonce: 'x', token_key_version: 'v1', actor_uid: 'firebase-admin' };
    await expect(consumeOAuthTransaction(env, 'tx-1', 'wrong-state')).resolves.toBeNull();
    await expect(consumeOAuthTransaction(env, 'tx-1', 'secret-state')).resolves.toMatchObject({ actor_uid: 'firebase-admin' });
    await expect(consumeOAuthTransaction(env, 'tx-1', 'secret-state')).resolves.toBeNull();
  });
});

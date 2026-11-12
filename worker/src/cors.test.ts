import { describe, expect, it } from 'vitest';
import { corsHeaders } from './index';

function createEnv(redirectUris: string[]) {
  const queries: string[] = [];
  const env = {
    ALLOWED_ORIGINS: 'https://hyperdatalab.org',
    FRONTEND_ORIGINS: '',
    DB: {
      prepare(sql: string) {
        queries.push(sql);
        return {
          async all() {
            return { success: true, results: [{ redirect_uris_json: JSON.stringify(redirectUris) }] };
          },
        };
      },
    },
  } as unknown as Parameters<typeof corsHeaders>[1];
  return { env, queries };
}

function preflight(url: string, origin: string) {
  return new Request(url, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type',
    },
  });
}

describe('Worker SSO browser CORS', () => {
  it('allows a Public client origin derived from its registered callback URL', async () => {
    const { env, queries } = createEnv(['https://client.example.edu/auth/callback']);
    const headers = await corsHeaders(preflight('https://worker.test/oauth/token', 'https://client.example.edu'), env);

    expect(headers.get('access-control-allow-origin')).toBe('https://client.example.edu');
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("client_type = 'PUBLIC'");
    expect(queries[0]).toContain('is_active = 1');
  });

  it('does not allow a different scheme, hostname, or port', async () => {
    const { env } = createEnv(['http://localhost:3003/auth/callback']);
    const headers = await corsHeaders(preflight('https://worker.test/oauth/userinfo', 'http://localhost:3000'), env);

    expect(headers.has('access-control-allow-origin')).toBe(false);
  });

  it('does not dynamically allow non-OAuth endpoints', async () => {
    const { env, queries } = createEnv(['https://client.example.edu/auth/callback']);
    const headers = await corsHeaders(preflight('https://worker.test/api/workspace/users', 'https://client.example.edu'), env);

    expect(headers.has('access-control-allow-origin')).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('keeps explicitly configured origins working', async () => {
    const { env, queries } = createEnv([]);
    const headers = await corsHeaders(preflight('https://worker.test/oauth/token', 'https://hyperdatalab.org'), env);

    expect(headers.get('access-control-allow-origin')).toBe('https://hyperdatalab.org');
    expect(queries).toHaveLength(0);
  });
});

CREATE TABLE IF NOT EXISTS sso_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  name TEXT NOT NULL,
  description TEXT,
  client_type TEXT NOT NULL CHECK (client_type IN ('PUBLIC', 'CONFIDENTIAL')),
  redirect_uris_json TEXT NOT NULL,
  allowed_scopes_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sso_authorization_requests (
  request_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sso_authorization_requests_expiry_idx ON sso_authorization_requests(expires_at);

CREATE TABLE IF NOT EXISTS sso_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  profile_uid TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sso_authorization_codes_expiry_idx ON sso_authorization_codes(expires_at);

CREATE TABLE IF NOT EXISTS sso_access_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  profile_uid TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sso_access_tokens_expiry_idx ON sso_access_tokens(expires_at);

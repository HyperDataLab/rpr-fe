ALTER TABLE sso_access_tokens ADD COLUMN refresh_family_id TEXT;

CREATE INDEX IF NOT EXISTS sso_access_tokens_refresh_family_idx
  ON sso_access_tokens(refresh_family_id);

CREATE TABLE IF NOT EXISTS sso_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  profile_uid TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  rotated_to_hash TEXT
);

CREATE INDEX IF NOT EXISTS sso_refresh_tokens_family_idx
  ON sso_refresh_tokens(family_id);

CREATE INDEX IF NOT EXISTS sso_refresh_tokens_expiry_idx
  ON sso_refresh_tokens(expires_at);

CREATE INDEX IF NOT EXISTS sso_refresh_tokens_client_idx
  ON sso_refresh_tokens(client_id);

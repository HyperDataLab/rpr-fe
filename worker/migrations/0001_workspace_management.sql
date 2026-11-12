CREATE TABLE IF NOT EXISTS google_oauth_connections (
  id TEXT PRIMARY KEY CHECK (id = 'primary'),
  workspace_domain TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  admin_subject TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  refresh_token_nonce TEXT,
  token_key_version TEXT,
  granted_scopes TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CONNECTED', 'REVOKED', 'DISCONNECTED')),
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_transactions (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  pkce_ciphertext TEXT NOT NULL,
  pkce_nonce TEXT NOT NULL,
  token_key_version TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_transactions_expiry_idx ON oauth_transactions(expires_at);

CREATE TABLE IF NOT EXISTS workspace_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL,
  action TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  target_id TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS workspace_audit_actor_time_idx ON workspace_audit_logs(actor_uid, occurred_at DESC);
CREATE INDEX IF NOT EXISTS workspace_audit_action_time_idx ON workspace_audit_logs(action, occurred_at DESC);

CREATE TABLE IF NOT EXISTS workspace_rate_limits (
  actor_uid TEXT NOT NULL,
  operation TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (actor_uid, operation, window_start)
);

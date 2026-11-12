CREATE TABLE IF NOT EXISTS workspace_temp_credentials (
  workspace_email TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('READY')) DEFAULT 'READY',
  created_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_temp_credentials_expiry_idx
  ON workspace_temp_credentials (expires_at);

CREATE TABLE IF NOT EXISTS app_user_logins (
  profile_uid TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status TEXT NOT NULL CHECK (status IN ('PROVISIONING', 'LINKED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_user_pending_credentials (
  profile_uid TEXT PRIMARY KEY REFERENCES app_user_logins(profile_uid) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS app_user_pending_credentials_expiry_idx
  ON app_user_pending_credentials(expires_at);

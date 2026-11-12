CREATE TABLE IF NOT EXISTS workspace_identity_links (
  profile_uid TEXT PRIMARY KEY,
  workspace_email TEXT NOT NULL UNIQUE,
  workspace_user_id TEXT NOT NULL UNIQUE,
  personal_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROVISIONING', 'LINKED', 'SUSPENDED')) DEFAULT 'PROVISIONING',
  onboarding_email_status TEXT NOT NULL CHECK (onboarding_email_status IN ('PENDING', 'SENT', 'FAILED')) DEFAULT 'PENDING',
  linked_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_identity_links_email_idx
  ON workspace_identity_links (workspace_email);

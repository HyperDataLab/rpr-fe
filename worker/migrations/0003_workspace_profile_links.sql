CREATE TABLE IF NOT EXISTS workspace_profile_links (
  profile_uid TEXT PRIMARY KEY,
  workspace_email TEXT NOT NULL UNIQUE,
  workspace_user_id TEXT NOT NULL UNIQUE,
  personal_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('LINKED', 'SUSPENDED')) DEFAULT 'LINKED',
  onboarding_email_status TEXT NOT NULL CHECK (onboarding_email_status IN ('SENT', 'FAILED')) DEFAULT 'SENT',
  linked_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_profile_links_email_idx
  ON workspace_profile_links (workspace_email);

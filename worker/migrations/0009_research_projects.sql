CREATE TABLE IF NOT EXISTS research_projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  research_area TEXT NOT NULL DEFAULT '',
  owner_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_project_members (
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_uid TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'MEMBER')),
  status TEXT NOT NULL CHECK (status IN ('INVITED', 'ACTIVE', 'DECLINED')),
  invited_by_uid TEXT,
  invitation_email_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (invitation_email_status IN ('PENDING', 'SENT', 'FAILED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  responded_at TEXT,
  PRIMARY KEY (project_id, user_uid)
);

CREATE INDEX IF NOT EXISTS research_project_members_user_status_idx
  ON research_project_members(user_uid, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS research_project_members_project_status_idx
  ON research_project_members(project_id, status, created_at);

CREATE INDEX IF NOT EXISTS research_projects_owner_idx
  ON research_projects(owner_uid, updated_at DESC);

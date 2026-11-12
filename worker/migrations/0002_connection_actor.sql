ALTER TABLE google_oauth_connections
ADD COLUMN connected_by_uid TEXT NOT NULL DEFAULT 'system';

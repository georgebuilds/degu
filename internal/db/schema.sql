-- degu.db schema (v1)
--
-- Mirrors the historical index.json structure, normalised:
--   - file_tag        — file → tag (many to many)
--   - tag_created_at  — when each tag first appeared
--   - last_reviewed   — when each file was last deliberately reviewed
--   - video_loop      — saved A–B loop ranges per video file
--
-- All paths are stored as forward-slash relative paths under the server root.
-- Schema version is tracked via PRAGMA user_version (see internal/db/db.go).

CREATE TABLE IF NOT EXISTS file_tag (
  rel_path TEXT NOT NULL,
  tag      TEXT NOT NULL,
  PRIMARY KEY (rel_path, tag)
);
CREATE INDEX IF NOT EXISTS file_tag_tag_idx ON file_tag(tag);
CREATE INDEX IF NOT EXISTS idx_file_tag_rel_path ON file_tag(rel_path);

CREATE TABLE IF NOT EXISTS tag_created_at (
  tag        TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS last_reviewed (
  rel_path     TEXT PRIMARY KEY,
  reviewed_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_loop (
  rel_path  TEXT NOT NULL,
  loop_id   TEXT NOT NULL,
  start_sec REAL NOT NULL,
  end_sec   REAL NOT NULL,
  PRIMARY KEY (rel_path, loop_id),
  CHECK (start_sec >= 0 AND end_sec > start_sec)
);

// Package db owns the on-disk SQLite store at <root>/degu.db.
//
// It replaces the historical index.json sidecar with a small set of normalised
// tables; on first open we attempt to import an existing index.json once, so
// upgrading is a no-op for the user.
package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const DBFilename = "degu.db"

//go:embed schema.sql
var schemaFS embed.FS

// currentSchemaVersion is the version we expect after migrate() finishes.
// Bump this and add a case to migrate() when introducing a new schema rev.
const currentSchemaVersion = 2

// Open returns a *sql.DB pointing at <dir>/degu.db with sane pragmas
// (WAL, foreign keys on, busy timeout). The schema is created idempotently.
func Open(ctx context.Context, dir string) (*sql.DB, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("db: ensure dir %q: %w", dir, err)
	}
	path := filepath.Join(dir, DBFilename)

	q := url.Values{}
	q.Set("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "foreign_keys(on)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "synchronous(normal)")
	dsn := "file:" + path + "?" + q.Encode()

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("db: open %q: %w", path, err)
	}
	db.SetMaxOpenConns(1)

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}

	if err := migrate(ctx, db, currentSchemaVersion); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

// migrate brings the database up to target by stepping through versioned
// migrations keyed off PRAGMA user_version. v0 means "fresh DB" and is
// initialised by applying schema.sql.
func migrate(ctx context.Context, db *sql.DB, target int) error {
	var version int
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("db: read user_version: %w", err)
	}
	for version < target {
		switch version {
		case 0:
			schema, err := schemaFS.ReadFile("schema.sql")
			if err != nil {
				return fmt.Errorf("db: read embedded schema: %w", err)
			}
			if _, err := db.ExecContext(ctx, string(schema)); err != nil {
				return fmt.Errorf("db: apply schema: %w", err)
			}
		case 1:
			if _, err := db.ExecContext(ctx, migratePeople); err != nil {
				return fmt.Errorf("db: apply people migration: %w", err)
			}
		default:
			return fmt.Errorf("db: no migration registered from v%d", version)
		}
		version++
		if _, err := db.ExecContext(ctx, fmt.Sprintf(`PRAGMA user_version = %d`, version)); err != nil {
			return fmt.Errorf("db: set user_version=%d: %w", version, err)
		}
	}
	return nil
}

const migratePeople = `
CREATE TABLE IF NOT EXISTS person (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS face_region (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_path  TEXT NOT NULL,
  person_id INTEGER REFERENCES person(id) ON DELETE SET NULL,
  x         REAL,
  y         REAL,
  w         REAL,
  h         REAL,
  source    TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto','confirmed')),
  confidence REAL
);
CREATE INDEX IF NOT EXISTS idx_face_region_path   ON face_region(rel_path);
CREATE INDEX IF NOT EXISTS idx_face_region_person ON face_region(person_id);
`

// IsEmpty reports whether the store has no tag rows yet — used to decide
// whether to attempt a one-shot import from a legacy index.json.
func IsEmpty(ctx context.Context, db *sql.DB) (bool, error) {
	row := db.QueryRowContext(ctx,
		`SELECT
		   (SELECT COUNT(*) FROM file_tag) +
		   (SELECT COUNT(*) FROM tag_created_at) +
		   (SELECT COUNT(*) FROM last_reviewed) +
		   (SELECT COUNT(*) FROM video_loop)`)
	var n int
	if err := row.Scan(&n); err != nil {
		return false, fmt.Errorf("db: count rows: %w", err)
	}
	return n == 0, nil
}

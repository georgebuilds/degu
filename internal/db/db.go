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
	// One writer; many readers. modernc/sqlite is happy with this.
	db.SetMaxOpenConns(1)

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}

	schema, err := schemaFS.ReadFile("schema.sql")
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("db: read embedded schema: %w", err)
	}
	if _, err := db.ExecContext(ctx, string(schema)); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("db: apply schema: %w", err)
	}
	return db, nil
}

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

package db

import (
	"context"
	"database/sql"
	"fmt"
)

// VideoLoop is a saved A–B loop range on a video file.
type VideoLoop struct {
	ID       string  `json:"id"`
	StartSec float64 `json:"startSec"`
	EndSec   float64 `json:"endSec"`
}

// TagState is the full set of tag-adjacent state for the current root.
//
// It is the wire shape between the Go server and the SPA, and it mirrors the
// shape the SPA used to read/write directly against index.json — so frontend
// code that already speaks this shape can swap fetch() for a file read with
// no semantic change.
type TagState struct {
	Tags         map[string][]string    `json:"tags"`
	VideoLoops   map[string][]VideoLoop `json:"videoLoops"`
	TagCreatedAt map[string]string      `json:"tagCreatedAt"`
	LastReviewed map[string]string      `json:"lastReviewed"`
}

// Empty returns a TagState with non-nil zero-length maps. The wire format
// always emits objects (never `null`) so the SPA can dereference safely.
func Empty() *TagState {
	return &TagState{
		Tags:         map[string][]string{},
		VideoLoops:   map[string][]VideoLoop{},
		TagCreatedAt: map[string]string{},
		LastReviewed: map[string]string{},
	}
}

// LoadTagState reads the entire tag state into memory. The SPA calls this once
// on boot and then keeps state in memory, debouncing writes via SaveTagState.
func LoadTagState(ctx context.Context, db *sql.DB) (*TagState, error) {
	state := Empty()

	if err := loadFileTags(ctx, db, state); err != nil {
		return nil, err
	}
	if err := loadTagCreatedAt(ctx, db, state); err != nil {
		return nil, err
	}
	if err := loadLastReviewed(ctx, db, state); err != nil {
		return nil, err
	}
	if err := loadVideoLoops(ctx, db, state); err != nil {
		return nil, err
	}
	return state, nil
}

func loadFileTags(ctx context.Context, db *sql.DB, state *TagState) error {
	rows, err := db.QueryContext(ctx, `SELECT rel_path, tag FROM file_tag`)
	if err != nil {
		return fmt.Errorf("db: load file_tag: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var path, tag string
		if err := rows.Scan(&path, &tag); err != nil {
			return err
		}
		state.Tags[path] = append(state.Tags[path], tag)
	}
	return rows.Err()
}

func loadTagCreatedAt(ctx context.Context, db *sql.DB, state *TagState) error {
	rows, err := db.QueryContext(ctx, `SELECT tag, created_at FROM tag_created_at`)
	if err != nil {
		return fmt.Errorf("db: load tag_created_at: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var tag, ts string
		if err := rows.Scan(&tag, &ts); err != nil {
			return err
		}
		state.TagCreatedAt[tag] = ts
	}
	return rows.Err()
}

func loadLastReviewed(ctx context.Context, db *sql.DB, state *TagState) error {
	rows, err := db.QueryContext(ctx, `SELECT rel_path, reviewed_at FROM last_reviewed`)
	if err != nil {
		return fmt.Errorf("db: load last_reviewed: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var path, ts string
		if err := rows.Scan(&path, &ts); err != nil {
			return err
		}
		state.LastReviewed[path] = ts
	}
	return rows.Err()
}

func loadVideoLoops(ctx context.Context, db *sql.DB, state *TagState) error {
	rows, err := db.QueryContext(ctx, `SELECT rel_path, loop_id, start_sec, end_sec FROM video_loop`)
	if err != nil {
		return fmt.Errorf("db: load video_loop: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var path string
		loop := VideoLoop{}
		if err := rows.Scan(&path, &loop.ID, &loop.StartSec, &loop.EndSec); err != nil {
			return err
		}
		state.VideoLoops[path] = append(state.VideoLoops[path], loop)
	}
	return rows.Err()
}

// SaveTagState replaces the full state in a single transaction. The SPA writes
// the whole map on every save (mirroring how it used to write index.json), so
// "delete-then-insert" inside a transaction is the cleanest semantics.
//
// Future optimisation: PATCH endpoints for delta updates.
func SaveTagState(ctx context.Context, db *sql.DB, state *TagState) error {
	if state == nil {
		state = Empty()
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("db: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	for _, table := range []string{"file_tag", "tag_created_at", "last_reviewed", "video_loop"} {
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+table); err != nil {
			return fmt.Errorf("db: clear %s: %w", table, err)
		}
	}

	if len(state.Tags) > 0 {
		stmt, err := tx.PrepareContext(ctx, `INSERT INTO file_tag (rel_path, tag) VALUES (?, ?)`)
		if err != nil {
			return fmt.Errorf("db: prepare file_tag: %w", err)
		}
		for path, tags := range state.Tags {
			for _, tag := range tags {
				if tag == "" {
					continue
				}
				if _, err := stmt.ExecContext(ctx, path, tag); err != nil {
					stmt.Close()
					return fmt.Errorf("db: insert file_tag: %w", err)
				}
			}
		}
		stmt.Close()
	}

	if len(state.TagCreatedAt) > 0 {
		stmt, err := tx.PrepareContext(ctx, `INSERT INTO tag_created_at (tag, created_at) VALUES (?, ?)`)
		if err != nil {
			return fmt.Errorf("db: prepare tag_created_at: %w", err)
		}
		for tag, ts := range state.TagCreatedAt {
			if _, err := stmt.ExecContext(ctx, tag, ts); err != nil {
				stmt.Close()
				return fmt.Errorf("db: insert tag_created_at: %w", err)
			}
		}
		stmt.Close()
	}

	if len(state.LastReviewed) > 0 {
		stmt, err := tx.PrepareContext(ctx, `INSERT INTO last_reviewed (rel_path, reviewed_at) VALUES (?, ?)`)
		if err != nil {
			return fmt.Errorf("db: prepare last_reviewed: %w", err)
		}
		for path, ts := range state.LastReviewed {
			if _, err := stmt.ExecContext(ctx, path, ts); err != nil {
				stmt.Close()
				return fmt.Errorf("db: insert last_reviewed: %w", err)
			}
		}
		stmt.Close()
	}

	if len(state.VideoLoops) > 0 {
		stmt, err := tx.PrepareContext(ctx, `INSERT INTO video_loop (rel_path, loop_id, start_sec, end_sec) VALUES (?, ?, ?, ?)`)
		if err != nil {
			return fmt.Errorf("db: prepare video_loop: %w", err)
		}
		for path, loops := range state.VideoLoops {
			for _, loop := range loops {
				if loop.ID == "" || loop.EndSec <= loop.StartSec {
					continue
				}
				if _, err := stmt.ExecContext(ctx, path, loop.ID, loop.StartSec, loop.EndSec); err != nil {
					stmt.Close()
					return fmt.Errorf("db: insert video_loop: %w", err)
				}
			}
		}
		stmt.Close()
	}

	return tx.Commit()
}

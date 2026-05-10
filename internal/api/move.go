package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
)

type MoveRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type MoveBatchRequest struct {
	Moves []MoveRequest `json:"moves"`
}

// MoveHandler renames files inside root and updates the corresponding rows in
// degu.db (file_tag, last_reviewed, video_loop) in a single transaction so
// tags follow the rename atomically.
//
// Accepts both /api/move (single rename) and /api/move/batch (multi-rename
// in one request) — the batch path is what NormalizeFilenames reaches for.
func MoveHandler(root string, d *sql.DB) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/move", func(w http.ResponseWriter, r *http.Request) {
		var req MoveRequest
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "decode: "+err.Error())
			return
		}
		if err := applyMoves(r.Context(), root, d, []MoveRequest{req}); err != nil {
			writeMoveError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	mux.HandleFunc("POST /api/move/batch", func(w http.ResponseWriter, r *http.Request) {
		var req MoveBatchRequest
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<20))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "decode: "+err.Error())
			return
		}
		if err := applyMoves(r.Context(), root, d, req.Moves); err != nil {
			writeMoveError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"count":` + itoa(len(req.Moves)) + `}`))
	})

	return mux
}

func writeMoveError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnsafePath):
		writeJSONError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, fs.ErrNotExist):
		writeJSONError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, fs.ErrExist):
		writeJSONError(w, http.StatusConflict, err.Error())
	default:
		writeJSONError(w, http.StatusInternalServerError, err.Error())
	}
}

func applyMoves(ctx context.Context, root string, d *sql.DB, moves []MoveRequest) error {
	type resolved struct{ fromAbs, toAbs, fromRel, toRel string }
	plans := make([]resolved, 0, len(moves))
	seenFrom := make(map[string]struct{}, len(moves))
	for _, m := range moves {
		if m.From == "" || m.To == "" {
			return errors.New("move: from and to required")
		}
		if m.From == m.To {
			return errors.New("move: from == to: " + m.From)
		}
		if _, dup := seenFrom[m.From]; dup {
			return errors.New("move: duplicate from in batch: " + m.From)
		}
		seenFrom[m.From] = struct{}{}
		fromAbs, err := SafeJoin(root, m.From)
		if err != nil {
			return err
		}
		toAbs, err := SafeJoin(root, m.To)
		if err != nil {
			return err
		}
		plans = append(plans, resolved{fromAbs, toAbs, m.From, m.To})
	}

	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	updateTags, err := tx.PrepareContext(ctx, `UPDATE file_tag SET rel_path = ? WHERE rel_path = ?`)
	if err != nil {
		return err
	}
	defer updateTags.Close()
	updateReviewed, err := tx.PrepareContext(ctx, `UPDATE last_reviewed SET rel_path = ? WHERE rel_path = ?`)
	if err != nil {
		return err
	}
	defer updateReviewed.Close()
	updateLoops, err := tx.PrepareContext(ctx, `UPDATE video_loop SET rel_path = ? WHERE rel_path = ?`)
	if err != nil {
		return err
	}
	defer updateLoops.Close()

	type renamed struct{ from, to, fromRel, toRel string }
	var done []renamed
	// rollbackRenames reverts the renames in `done` in reverse order. Returns
	// the indices into `done` whose revert *failed* (i.e. files still on disk
	// at their toAbs), plus a joined error for those failures.
	rollbackRenames := func() ([]int, error) {
		var failed []int
		var errs []error
		for i := len(done) - 1; i >= 0; i-- {
			r := done[i]
			if err := os.Rename(r.to, r.from); err != nil {
				log.Printf("api: move: compensating rename %q -> %q failed: %v", r.to, r.from, err)
				errs = append(errs, fmt.Errorf("compensating rename %q -> %q: %w", r.to, r.from, err))
				failed = append(failed, i)
			}
		}
		return failed, errors.Join(errs...)
	}
	// wrapRollback is called on any in-flight failure. When the filesystem
	// fully reverts, the deferred tx.Rollback restores the DB to its original
	// state. When it doesn't (some files stayed at their new path), we update
	// the DB so its rows match on-disk truth — for indices that *did* revert,
	// undo their pending UPDATE; the rest already point at toRel inside the
	// open transaction. Then commit, so the SPA's next scan agrees with disk.
	wrapRollback := func(orig error) error {
		failedIdx, rerr := rollbackRenames()
		if rerr == nil {
			return orig
		}
		failed := make(map[int]struct{}, len(failedIdx))
		for _, i := range failedIdx {
			failed[i] = struct{}{}
		}
		var fixupErrs []error
		for i, r := range done {
			if _, stayedRenamed := failed[i]; stayedRenamed {
				continue
			}
			if _, err := updateTags.ExecContext(ctx, r.fromRel, r.toRel); err != nil {
				fixupErrs = append(fixupErrs, err)
			}
			if _, err := updateReviewed.ExecContext(ctx, r.fromRel, r.toRel); err != nil {
				fixupErrs = append(fixupErrs, err)
			}
			if _, err := updateLoops.ExecContext(ctx, r.fromRel, r.toRel); err != nil {
				fixupErrs = append(fixupErrs, err)
			}
		}
		var note string
		if len(fixupErrs) == 0 {
			if cerr := tx.Commit(); cerr != nil {
				fixupErrs = append(fixupErrs, fmt.Errorf("partial-state commit: %w", cerr))
				note = "DB rolled back; rows reference original paths but some files remain renamed"
			} else {
				note = "DB committed to match on-disk state"
			}
		} else {
			note = "DB rolled back; rows reference original paths but some files remain renamed"
		}
		log.Printf("api: move: rollback partial (%d rename(s) could not be reverted) — %s", len(failedIdx), note)
		return errors.Join(orig,
			fmt.Errorf("rollback partial: %d rename(s) could not be reverted (%s): %w", len(failedIdx), note, rerr),
			errors.Join(fixupErrs...))
	}

	for _, p := range plans {
		if err := renameNoOverwrite(p.fromAbs, p.toAbs); err != nil {
			return wrapRollback(err)
		}
		done = append(done, renamed{from: p.fromAbs, to: p.toAbs, fromRel: p.fromRel, toRel: p.toRel})
		if _, err := updateTags.ExecContext(ctx, p.toRel, p.fromRel); err != nil {
			return wrapRollback(err)
		}
		if _, err := updateReviewed.ExecContext(ctx, p.toRel, p.fromRel); err != nil {
			return wrapRollback(err)
		}
		if _, err := updateLoops.ExecContext(ctx, p.toRel, p.fromRel); err != nil {
			return wrapRollback(err)
		}
	}

	if err := tx.Commit(); err != nil {
		return wrapRollback(err)
	}
	return nil
}

// renameNoOverwrite renames from -> to and refuses to clobber an existing
// destination. There is a tiny TOCTOU window between the lstat and rename;
// the goal here is to close the much larger window where os.Rename silently
// overwrites on Unix.
func renameNoOverwrite(from, to string) error {
	if _, err := os.Lstat(to); err == nil {
		return fmt.Errorf("%w: %s", fs.ErrExist, to)
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return os.Rename(from, to)
}

// itoa: small int → string without pulling strconv on the hot path.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

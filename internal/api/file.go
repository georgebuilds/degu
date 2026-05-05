package api

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// FileHandler streams a single file out of root (GET) or removes it (DELETE).
// Range requests are supported on GET so <video> seek works without us writing
// any range parsing by hand.
//
// Mounted at /api/file/, the path tail is treated as a forward-slash relative
// path inside root; URL-decoding is performed by net/http before we see it.
//
// The db handle is used on DELETE to clean up tag rows that referenced the
// removed path; passing nil disables that cleanup.
func FileHandler(root string, d *sql.DB) http.Handler {
	const prefix = "/api/file/"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := trimAPIPrefix(r, prefix)
		if rel == "" {
			writeJSONError(w, http.StatusBadRequest, "file: missing path")
			return
		}
		abs, err := SafeJoin(root, rel)
		if err != nil {
			writeJSONError(w, http.StatusForbidden, err.Error())
			return
		}

		if r.Method == http.MethodDelete {
			handleFileDelete(r, w, d, abs, rel)
			return
		}

		base := strings.ToLower(filepath.Base(abs))
		if strings.HasPrefix(base, "degu.db") {
			writeJSONError(w, http.StatusNotFound, "file: "+rel)
			return
		}
		if !isServableExt(strings.ToLower(filepath.Ext(abs))) {
			writeJSONError(w, http.StatusNotFound, "file: "+rel)
			return
		}

		info, err := os.Stat(abs)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				writeJSONError(w, http.StatusNotFound, "file: "+rel)
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if info.IsDir() {
			writeJSONError(w, http.StatusBadRequest, "file: is a directory")
			return
		}

		f, err := os.Open(abs)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer f.Close()

		// Pin the content type by extension so browsers don't have to sniff;
		// http.ServeContent will fall back to sniffing if we don't set it.
		if ct := mimeByExt(abs); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		w.Header().Set("Accept-Ranges", "bytes")
		// Cache at the SPA's discretion — the bytes are stable until the
		// underlying file changes; ETag is mtime+size which is fine for
		// local-filesystem semantics.
		w.Header().Set("ETag", `"`+strconv.FormatInt(info.ModTime().UnixNano(), 36)+
			"-"+strconv.FormatInt(info.Size(), 36)+`"`)

		http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	})
}

// handleFileDelete removes a file (or empty directory) and best-effort drops
// any tag/review/loop rows that referenced its rel_path.
func handleFileDelete(r *http.Request, w http.ResponseWriter, d *sql.DB, abs, rel string) {
	info, err := os.Lstat(abs)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			writeJSONError(w, http.StatusNotFound, "file: "+rel)
			return
		}
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	isDir := info.IsDir()
	if err := os.Remove(abs); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			writeJSONError(w, http.StatusNotFound, "file: "+rel)
			return
		}
		if isDir {
			writeJSONError(w, http.StatusConflict, err.Error())
			return
		}
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if d != nil {
		if err := deleteTagRowsForPath(r.Context(), d, rel, isDir); err != nil {
			log.Printf("api: file delete: cleanup tag rows for %q: %v", rel, err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func deleteTagRowsForPath(ctx context.Context, d *sql.DB, rel string, isDir bool) error {
	tables := []string{"file_tag", "last_reviewed", "video_loop"}
	for _, table := range tables {
		if _, err := d.ExecContext(ctx, "DELETE FROM "+table+" WHERE rel_path = ?", rel); err != nil {
			return err
		}
		if isDir {
			prefix := strings.TrimSuffix(rel, "/") + "/"
			if _, err := d.ExecContext(ctx, "DELETE FROM "+table+" WHERE rel_path LIKE ? || '%'", prefix); err != nil {
				return err
			}
		}
	}
	return nil
}

// mimeByExt returns a content-type or "" when we don't have a guess; we
// override a couple of types Go's default mime db gets wrong for media.
func mimeByExt(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".mkv":
		return "video/x-matroska"
	case ".avi":
		return "video/x-msvideo"
	case ".heic":
		return "image/heic"
	case ".avif":
		return "image/avif"
	}
	return mime.TypeByExtension(ext)
}

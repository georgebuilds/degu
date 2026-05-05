package api

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

// SaveHandler writes a request body to <root>/<path>.
//
// Used by the in-browser ffmpeg trim flow to persist its output without
// needing showSaveFilePicker. Refuses to overwrite an existing file unless
// the `overwrite=1` query param is set, so the SPA has to opt in.
func SaveHandler(root string) http.Handler {
	const prefix = "/api/save/"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut && r.Method != http.MethodPost {
			w.Header().Set("Allow", "PUT, POST")
			writeJSONError(w, http.StatusMethodNotAllowed, "save: method not allowed")
			return
		}
		rel := trimAPIPrefix(r, prefix)
		if rel == "" {
			writeJSONError(w, http.StatusBadRequest, "save: missing path")
			return
		}
		abs, err := SafeJoin(root, rel)
		if err != nil {
			writeJSONError(w, http.StatusForbidden, err.Error())
			return
		}
		overwrite := r.URL.Query().Get("overwrite") == "1"
		if !overwrite {
			if _, err := os.Stat(abs); err == nil {
				writeJSONError(w, http.StatusConflict, "save: file exists")
				return
			} else if !errors.Is(err, fs.ErrNotExist) {
				writeJSONError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}

		// Write to a sibling temp file then rename — atomic on the same
		// filesystem, leaves no half-written file if the connection drops.
		tmp, err := os.CreateTemp(filepath.Dir(abs), ".degu-save-*")
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		tmpPath := tmp.Name()
		cleanup := func() { _ = os.Remove(tmpPath) }

		// Cap incoming bodies at 4 GiB to prevent runaway uploads filling the
		// disk; trimmed videos are typically well under this.
		body := http.MaxBytesReader(w, r.Body, 4<<30)
		written, err := tmp.ReadFrom(body)
		if cerr := tmp.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			cleanup()
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := os.Rename(tmpPath, abs); err != nil {
			cleanup()
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"path":"` + jsonEscape(rel) + `","size":` +
			strconv.FormatInt(written, 10) + `}`))
	})
}

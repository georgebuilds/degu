package api

import (
	"errors"
	"io/fs"
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
func FileHandler(root string) http.Handler {
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
			if err := os.Remove(abs); err != nil {
				if errors.Is(err, fs.ErrNotExist) {
					writeJSONError(w, http.StatusNotFound, "file: "+rel)
					return
				}
				writeJSONError(w, http.StatusInternalServerError, err.Error())
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
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

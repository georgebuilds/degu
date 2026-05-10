package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ScanEntry mirrors a single file in the recursive listing.
type ScanEntry struct {
	Path    string `json:"path"` // forward-slash relative
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"` // unix milliseconds
	Kind    string `json:"kind"`    // "image" | "video"
}

type ScanResponse struct {
	Root    string      `json:"root"`
	Entries []ScanEntry `json:"entries"`
}

// videoExts, imageExts and audioExts mirror src/lib/supported-media.ts so the
// server's idea of "media file" matches the SPA's exactly. Keep these lists
// in sync.
var videoExts = map[string]struct{}{
	".mp4": {}, ".m4v": {}, ".webm": {}, ".mov": {}, ".mkv": {}, ".avi": {},
}
var imageExts = map[string]struct{}{
	".jpg": {}, ".jpeg": {}, ".png": {}, ".webp": {},
	".svg": {}, ".avif": {}, ".gif": {}, ".heic": {},
}
var audioExts = map[string]struct{}{
	".mp3": {}, ".wav": {}, ".flac": {}, ".ogg": {},
	".opus": {}, ".aac": {}, ".m4a": {},
}

func mediaKind(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	if _, ok := videoExts[ext]; ok {
		return "video"
	}
	if _, ok := imageExts[ext]; ok {
		return "image"
	}
	return ""
}

// isServableExt reports whether GET /api/file/ is allowed to stream a file
// with the given (lowercase, leading-dot) extension. Media + index.json only;
// everything else returns 404 to avoid leaking existence.
func isServableExt(ext string) bool {
	if _, ok := videoExts[ext]; ok {
		return true
	}
	if _, ok := imageExts[ext]; ok {
		return true
	}
	if _, ok := audioExts[ext]; ok {
		return true
	}
	return ext == ".json"
}

// isReservedFilename reports whether a (lowercased) basename refers to one of
// degu's working files: the SQLite database and its journal/WAL siblings, or
// the FSA driver's index.json tag store and its tmp/bak siblings. The HTTP API
// must refuse to read, write, or delete these — they're owned by the storage
// layer, and exposing them lets a same-origin caller corrupt the tag store.
func isReservedFilename(base string) bool {
	if strings.HasPrefix(base, "degu.db") {
		return true
	}
	switch base {
	case "index.json", "index.json.tmp", "index.json.bak":
		return true
	}
	return false
}

// ScanHandler walks root recursively and returns every supported media file
// as a flat list with size + mtime.
//
// Hidden directories (leading dot) and the degu working files (degu.db) are
// skipped so the listing stays media-only.
func ScanHandler(root string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entries := make([]ScanEntry, 0, 256)
		err := filepath.WalkDir(root, func(absPath string, d os.DirEntry, walkErr error) error {
			if err := r.Context().Err(); err != nil {
				return err
			}
			if walkErr != nil {
				// Permission failures on individual subtrees shouldn't fail
				// the whole scan — log via response would be noisy, just skip.
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			name := d.Name()
			if d.IsDir() {
				if absPath == root {
					return nil
				}
				if strings.HasPrefix(name, ".") {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.HasPrefix(name, ".") {
				return nil
			}
			kind := mediaKind(name)
			if kind == "" {
				return nil
			}
			rel, err := RelFromAbs(root, absPath)
			if err != nil {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			entries = append(entries, ScanEntry{
				Path:    rel,
				Name:    name,
				Size:    info.Size(),
				ModTime: info.ModTime().UnixMilli(),
				Kind:    kind,
			})
			return nil
		})
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				// Client disconnected mid-walk; nothing to write.
				return
			}
			writeJSONError(w, http.StatusInternalServerError, "scan: "+err.Error())
			return
		}

		sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(ScanResponse{Root: root, Entries: entries})
	})
}

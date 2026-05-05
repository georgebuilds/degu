package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ScanEntry mirrors a single file in the recursive listing.
type ScanEntry struct {
	Path    string `json:"path"`    // forward-slash relative
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"` // unix milliseconds
	Kind    string `json:"kind"`    // "image" | "video"
}

type ScanResponse struct {
	Root    string      `json:"root"`
	Entries []ScanEntry `json:"entries"`
}

// videoExts and imageExts mirror src/lib/supported-media.ts so the server's
// idea of "media file" matches the SPA's exactly. Keep these two lists in
// sync.
var videoExts = map[string]struct{}{
	".mp4": {}, ".m4v": {}, ".webm": {}, ".mov": {}, ".mkv": {}, ".avi": {},
}
var imageExts = map[string]struct{}{
	".jpg": {}, ".jpeg": {}, ".png": {}, ".webp": {},
	".svg": {}, ".avif": {}, ".gif": {},
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

// ScanHandler walks root recursively and returns every supported media file
// as a flat list with size + mtime.
//
// Hidden directories (leading dot) and the degu working files (degu.db) are
// skipped so the listing stays media-only.
func ScanHandler(root string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entries := make([]ScanEntry, 0, 256)
		err := filepath.WalkDir(root, func(absPath string, d os.DirEntry, walkErr error) error {
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
			writeJSONError(w, http.StatusInternalServerError, "scan: "+err.Error())
			return
		}

		sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(ScanResponse{Root: root, Entries: entries})
	})
}

package api

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type StatsKindBreakdown struct {
	Image int64 `json:"image"`
	Video int64 `json:"video"`
}

type StatsExtension struct {
	Ext   string `json:"ext"`
	Bytes int64  `json:"bytes"`
	Files int    `json:"files"`
}

type StatsTagBreakdown struct {
	Tag   string `json:"tag"`
	Bytes int64  `json:"bytes"`
	Files int    `json:"files"`
}

type StatsResponse struct {
	TotalBytes int64               `json:"totalBytes"`
	TotalFiles int                 `json:"totalFiles"`
	ByKind     StatsKindBreakdown  `json:"byKind"`
	ByExt      []StatsExtension    `json:"byExt"`
	ByTag      []StatsTagBreakdown `json:"byTag"`
}

// StatsHandler returns the same breakdowns the SPA used to compute by walking
// the FSA tree, but reads them from disk + degu.db in a single request — far
// cheaper than scanning every file from JS.
func StatsHandler(root string, d *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var (
			totalBytes int64
			totalFiles int
			byKind     StatsKindBreakdown
			byExt      = map[string]*StatsExtension{}
		)
		// path → (kind, size) so we can join against tags afterwards.
		type fileFact struct {
			kind string
			size int64
		}
		byPath := make(map[string]fileFact, 256)

		err := filepath.WalkDir(root, func(absPath string, dirEntry os.DirEntry, walkErr error) error {
			if err := r.Context().Err(); err != nil {
				return err
			}
			if walkErr != nil {
				if dirEntry != nil && dirEntry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			name := dirEntry.Name()
			if dirEntry.IsDir() {
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
			info, err := dirEntry.Info()
			if err != nil {
				return nil
			}
			rel, err := RelFromAbs(root, absPath)
			if err != nil {
				return nil
			}
			size := info.Size()
			totalBytes += size
			totalFiles++
			switch kind {
			case "image":
				byKind.Image += size
			case "video":
				byKind.Video += size
			}
			ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
			if ext == "" {
				ext = "(none)"
			}
			e, ok := byExt[ext]
			if !ok {
				e = &StatsExtension{Ext: ext}
				byExt[ext] = e
			}
			e.Bytes += size
			e.Files++
			byPath[rel] = fileFact{kind: kind, size: size}
			return nil
		})
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "stats: "+err.Error())
			return
		}

		// Tag join: build per-tag sums by querying file_tag.
		byTag := map[string]*StatsTagBreakdown{}
		if d != nil {
			rows, err := d.QueryContext(r.Context(), `SELECT rel_path, tag FROM file_tag`)
			if err != nil {
				log.Printf("api: stats: query file_tag: %v", err)
				writeJSONError(w, http.StatusInternalServerError, "stats: query tags: "+err.Error())
				return
			}
			for rows.Next() {
				var path, tag string
				if err := rows.Scan(&path, &tag); err != nil {
					rows.Close()
					log.Printf("api: stats: scan file_tag row: %v", err)
					writeJSONError(w, http.StatusInternalServerError, "stats: scan tags: "+err.Error())
					return
				}
				ff, ok := byPath[path]
				if !ok {
					continue
				}
				b, exists := byTag[tag]
				if !exists {
					b = &StatsTagBreakdown{Tag: tag}
					byTag[tag] = b
				}
				b.Bytes += ff.size
				b.Files++
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				log.Printf("api: stats: iterate file_tag: %v", err)
				writeJSONError(w, http.StatusInternalServerError, "stats: iterate tags: "+err.Error())
				return
			}
			rows.Close()
		}

		out := StatsResponse{
			TotalBytes: totalBytes,
			TotalFiles: totalFiles,
			ByKind:     byKind,
			ByExt:      make([]StatsExtension, 0, len(byExt)),
			ByTag:      make([]StatsTagBreakdown, 0, len(byTag)),
		}
		for _, e := range byExt {
			out.ByExt = append(out.ByExt, *e)
		}
		sort.Slice(out.ByExt, func(i, j int) bool { return out.ByExt[i].Bytes > out.ByExt[j].Bytes })
		for _, t := range byTag {
			out.ByTag = append(out.ByTag, *t)
		}
		sort.Slice(out.ByTag, func(i, j int) bool { return out.ByTag[i].Bytes > out.ByTag[j].Bytes })

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(out)
	})
}

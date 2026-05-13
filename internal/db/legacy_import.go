package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const legacyIndexFilename = "index.json"

// LegacyIndexStatus reports whether a one-shot legacy import can be offered
// to the user.
type LegacyIndexStatus struct {
	// Available is true when the DB is empty AND <root>/index.json exists and
	// can be parsed.
	Available bool `json:"available"`
	// EntryCount is the number of distinct path keys after path-canonicalisation
	// and dedup. Caller can use this to populate the migration prompt.
	EntryCount int `json:"entryCount"`
}

// ProbeLegacyIndex inspects the on-disk index.json and the DB without
// modifying either. A missing index.json is not an error — it just means the
// import is unavailable.
func ProbeLegacyIndex(ctx context.Context, d *sql.DB, root string) (LegacyIndexStatus, error) {
	empty, err := IsEmpty(ctx, d)
	if err != nil {
		return LegacyIndexStatus{}, err
	}
	if !empty {
		return LegacyIndexStatus{Available: false}, nil
	}
	parsed, err := readAndParseLegacy(root)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return LegacyIndexStatus{Available: false}, nil
		}
		return LegacyIndexStatus{}, err
	}
	return LegacyIndexStatus{Available: true, EntryCount: len(parsed.Tags)}, nil
}

// ImportProgress is one event emitted during ImportLegacyIndex. Phase changes
// in order: "verifying" → "saving" → "done".
type ImportProgress struct {
	Phase string `json:"phase"`
	Done  int    `json:"done"`
	Total int    `json:"total"`
}

// ImportLegacyResult is the final summary. Missing is sorted, capped at a
// generous limit so we don't ship megabytes back to the SPA.
type ImportLegacyResult struct {
	Imported         int      `json:"imported"`
	Missing          []string `json:"missing"`
	SkippedMalformed int      `json:"skippedMalformed"`
}

// missingCap bounds how many missing paths we report back. A user with 50k
// stale entries doesn't need every one — they need to know it happened.
const missingCap = 1000

// ImportLegacyIndex parses <root>/index.json, verifies each path exists on
// disk, dedupes tags within each path, saves the result, and removes the JSON.
//
// onProgress, if non-nil, is invoked from this goroutine (synchronously) with
// progress events.
//
// Idempotency: ProbeLegacyIndex's Available gate already requires the DB to
// be empty, so this should only be called once per folder. We re-check Empty()
// here as a defensive measure — concurrent invocation is unlikely but the
// damage from a second import would be a transaction error or worse.
func ImportLegacyIndex(
	ctx context.Context,
	d *sql.DB,
	root string,
	onProgress func(ImportProgress),
) (ImportLegacyResult, error) {
	empty, err := IsEmpty(ctx, d)
	if err != nil {
		return ImportLegacyResult{}, err
	}
	if !empty {
		return ImportLegacyResult{}, fmt.Errorf("db: legacy import refused: DB is not empty")
	}

	parsed, err := readAndParseLegacy(root)
	if err != nil {
		return ImportLegacyResult{}, err
	}

	total := len(parsed.Tags)
	if onProgress != nil {
		onProgress(ImportProgress{Phase: "verifying", Done: 0, Total: total})
	}

	verifiedTags := make(map[string][]string, total)
	missing := make([]string, 0)
	done := 0
	for relPath, tags := range parsed.Tags {
		if err := ctx.Err(); err != nil {
			return ImportLegacyResult{}, err
		}
		abs := filepath.Join(root, filepath.FromSlash(relPath))
		info, statErr := os.Stat(abs)
		// Treat stat errors that aren't permission-denied as "missing": the
		// path can't be served, so the tag would be a dead reference. (We
		// could special-case EACCES, but the simpler thing is to report it
		// missing and let the user re-tag if they fix permissions.)
		if statErr != nil || info.IsDir() {
			if len(missing) < missingCap {
				missing = append(missing, relPath)
			}
		} else {
			verifiedTags[relPath] = tags
		}
		done++
		// Report ~every 1% but at least every 50 entries — too noisy on tiny
		// folders, too sparse on huge ones, this hits a reasonable middle.
		step := total / 100
		if step < 50 {
			step = 50
		}
		if onProgress != nil && (done%step == 0 || done == total) {
			onProgress(ImportProgress{Phase: "verifying", Done: done, Total: total})
		}
	}

	state := Empty()
	state.Tags = verifiedTags
	// Side-tables: keep only entries whose path was verified. The tag names
	// in TagCreatedAt aren't path-keyed so we keep them all (a tag that
	// survived verification will still be referenced; one that didn't is a
	// harmless orphan row).
	if parsed.VideoLoops != nil {
		for relPath, loops := range parsed.VideoLoops {
			if _, ok := verifiedTags[relPath]; !ok {
				continue
			}
			if len(loops) > 0 {
				state.VideoLoops[relPath] = loops
			}
		}
	}
	if parsed.LastReviewed != nil {
		for relPath, ts := range parsed.LastReviewed {
			if _, ok := verifiedTags[relPath]; !ok {
				continue
			}
			state.LastReviewed[relPath] = ts
		}
	}
	if parsed.TagCreatedAt != nil {
		for tag, ts := range parsed.TagCreatedAt {
			state.TagCreatedAt[tag] = ts
		}
	}

	if onProgress != nil {
		onProgress(ImportProgress{Phase: "saving", Done: 0, Total: 1})
	}
	if err := SaveTagState(ctx, d, state); err != nil {
		return ImportLegacyResult{}, err
	}
	if onProgress != nil {
		onProgress(ImportProgress{Phase: "saving", Done: 1, Total: 1})
	}

	// DB is the source of truth now. The JSON file is a confusing artifact —
	// remove it. If the remove fails (read-only volume, permissions), log it
	// and continue; the user can clean up manually and the next probe will
	// report unavailable because IsEmpty() is now false.
	jsonPath := filepath.Join(root, legacyIndexFilename)
	if err := os.Remove(jsonPath); err != nil && !errors.Is(err, fs.ErrNotExist) {
		log.Printf("importer: could not delete %s: %v", jsonPath, err)
	}

	if onProgress != nil {
		onProgress(ImportProgress{Phase: "done", Done: total, Total: total})
	}
	return ImportLegacyResult{
		Imported:         len(verifiedTags),
		Missing:          missing,
		SkippedMalformed: parsed.SkippedMalformed,
	}, nil
}

// parsedLegacy wraps the post-parse state with the count of malformed rows
// we skipped so callers can surface it.
type parsedLegacy struct {
	Tags             map[string][]string
	VideoLoops       map[string][]VideoLoop
	TagCreatedAt     map[string]string
	LastReviewed     map[string]string
	SkippedMalformed int
}

func readAndParseLegacy(root string) (*parsedLegacy, error) {
	raw, err := os.ReadFile(filepath.Join(root, legacyIndexFilename))
	if err != nil {
		return nil, err
	}
	return parseLegacyIndex(raw)
}

// parseLegacyIndex decodes the historical index.json shape and dedupes
// aggressively:
//   - keys are path-cleaned (forward-slash); colliding keys merge tag lists
//   - tags within each path are deduplicated and empties dropped
//   - paths that resolve outside root after cleaning are dropped
//
//	{
//	  "<rel/path>": ["tag1", "tag2", …],
//	  …,
//	  "__degu": {
//	    "videoLoops":   { "<rel/path>": [{id, startSec, endSec}, …] },
//	    "tagCreatedAt": { "<tag>": "<iso8601>" },
//	    "lastReviewed": { "<rel/path>": "<iso8601>" }
//	  }
//	}
func parseLegacyIndex(raw []byte) (*parsedLegacy, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		return nil, err
	}
	out := &parsedLegacy{
		Tags:         map[string][]string{},
		VideoLoops:   map[string][]VideoLoop{},
		TagCreatedAt: map[string]string{},
		LastReviewed: map[string]string{},
	}
	// Track unique (path, tag) pairs across the whole file so that two
	// differently-spelled-but-equivalent paths (e.g. `a/b.jpg` and `./a/b.jpg`)
	// can't end up as separate entries with duplicated tags.
	tagSets := map[string]map[string]struct{}{}

	const metaKey = "__degu"
	for k, v := range top {
		if k == metaKey {
			continue
		}
		clean, ok := canonRelPath(k)
		if !ok {
			out.SkippedMalformed++
			continue
		}
		var tags []string
		if err := json.Unmarshal(v, &tags); err != nil {
			out.SkippedMalformed++
			continue
		}
		set, ok := tagSets[clean]
		if !ok {
			set = map[string]struct{}{}
			tagSets[clean] = set
		}
		for _, t := range tags {
			t = strings.TrimSpace(t)
			if t == "" {
				continue
			}
			set[t] = struct{}{}
		}
	}
	for clean, set := range tagSets {
		if len(set) == 0 {
			out.SkippedMalformed++
			continue
		}
		list := make([]string, 0, len(set))
		for t := range set {
			list = append(list, t)
		}
		out.Tags[clean] = list
	}

	if rawMeta, ok := top[metaKey]; ok {
		var meta struct {
			VideoLoops   map[string][]VideoLoop `json:"videoLoops"`
			TagCreatedAt map[string]string      `json:"tagCreatedAt"`
			LastReviewed map[string]string      `json:"lastReviewed"`
		}
		if err := json.Unmarshal(rawMeta, &meta); err == nil {
			for raw, loops := range meta.VideoLoops {
				clean, ok := canonRelPath(raw)
				if !ok {
					continue
				}
				seenLoopIDs := map[string]struct{}{}
				var keep []VideoLoop
				for _, l := range loops {
					if l.ID == "" || l.EndSec <= l.StartSec {
						out.SkippedMalformed++
						continue
					}
					if _, dup := seenLoopIDs[l.ID]; dup {
						out.SkippedMalformed++
						continue
					}
					seenLoopIDs[l.ID] = struct{}{}
					keep = append(keep, l)
				}
				if len(keep) > 0 {
					out.VideoLoops[clean] = keep
				}
			}
			for tag, ts := range meta.TagCreatedAt {
				if ts != "" {
					out.TagCreatedAt[tag] = ts
				}
			}
			for raw, ts := range meta.LastReviewed {
				if ts == "" {
					continue
				}
				clean, ok := canonRelPath(raw)
				if !ok {
					continue
				}
				out.LastReviewed[clean] = ts
			}
		}
	}

	if out.SkippedMalformed > 0 {
		log.Printf("importer: skipped %d malformed entries", out.SkippedMalformed)
	}
	return out, nil
}

// canonRelPath cleans a legacy JSON path key into the forward-slash form the
// DB stores, and rejects anything that's not a sane relative reference
// (absolute, escapes via .., contains backslashes, empty after cleaning).
func canonRelPath(k string) (string, bool) {
	if k == "" {
		return "", false
	}
	if strings.Contains(k, "\\") {
		return "", false
	}
	if strings.HasPrefix(k, "/") {
		return "", false
	}
	// path.Clean uses forward slashes and collapses `.` / `..` / `//`.
	cleaned := path.Clean(k)
	if cleaned == "" || cleaned == "." {
		return "", false
	}
	if strings.HasPrefix(cleaned, "../") || cleaned == ".." {
		return "", false
	}
	return cleaned, true
}

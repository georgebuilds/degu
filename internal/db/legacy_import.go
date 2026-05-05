package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

const legacyIndexFilename = "index.json"

// MaybeImportLegacyIndex copies <root>/index.json into the database if and only
// if the database is empty *and* an index.json file is present. It is safe to
// call on every server start: a populated DB is left untouched.
//
// Returns (imported=true, nil) when an import actually happened, (false, nil)
// otherwise. Errors only propagate if a partially-readable index.json is found
// — a missing file is not an error.
func MaybeImportLegacyIndex(ctx context.Context, db *sql.DB, root string) (bool, error) {
	empty, err := IsEmpty(ctx, db)
	if err != nil || !empty {
		return false, err
	}
	path := filepath.Join(root, legacyIndexFilename)
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("db: read legacy %s: %w", legacyIndexFilename, err)
	}
	state, err := parseLegacyIndex(raw)
	if err != nil {
		return false, fmt.Errorf("db: parse legacy %s: %w", legacyIndexFilename, err)
	}
	if err := SaveTagState(ctx, db, state); err != nil {
		return false, err
	}
	return true, nil
}

// parseLegacyIndex decodes the historical index.json shape:
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
func parseLegacyIndex(raw []byte) (*TagState, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		return nil, err
	}
	state := Empty()

	const metaKey = "__degu"
	for k, v := range top {
		if k == metaKey {
			continue
		}
		var tags []string
		if err := json.Unmarshal(v, &tags); err != nil {
			// Tolerate malformed top-level entries — skip rather than fail the
			// whole import; a misshaped key blocks the user from getting the
			// rest of their data.
			continue
		}
		clean := tags[:0]
		for _, t := range tags {
			if t != "" {
				clean = append(clean, t)
			}
		}
		if len(clean) > 0 {
			state.Tags[k] = clean
		}
	}

	if rawMeta, ok := top[metaKey]; ok {
		var meta struct {
			VideoLoops   map[string][]VideoLoop `json:"videoLoops"`
			TagCreatedAt map[string]string      `json:"tagCreatedAt"`
			LastReviewed map[string]string      `json:"lastReviewed"`
		}
		if err := json.Unmarshal(rawMeta, &meta); err == nil {
			if meta.VideoLoops != nil {
				for path, loops := range meta.VideoLoops {
					var keep []VideoLoop
					for _, l := range loops {
						if l.ID != "" && l.EndSec > l.StartSec {
							keep = append(keep, l)
						}
					}
					if len(keep) > 0 {
						state.VideoLoops[path] = keep
					}
				}
			}
			if meta.TagCreatedAt != nil {
				for k, v := range meta.TagCreatedAt {
					if v != "" {
						state.TagCreatedAt[k] = v
					}
				}
			}
			if meta.LastReviewed != nil {
				for k, v := range meta.LastReviewed {
					if v != "" {
						state.LastReviewed[k] = v
					}
				}
			}
		}
	}

	return state, nil
}

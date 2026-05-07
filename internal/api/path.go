package api

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// ErrUnsafePath is returned when a request resolves to a location outside the
// configured root, or contains traversal we refuse to follow.
var ErrUnsafePath = errors.New("api: path escapes root")

// SafeJoin resolves rel underneath root and guarantees the result stays
// inside root. The relative path is canonicalised (forward slashes only,
// no `..`, leading slashes stripped).
//
// It does NOT touch the filesystem; callers are responsible for stat-ing
// or open-ing the result.
func SafeJoin(root, rel string) (string, error) {
	rel = strings.TrimPrefix(rel, "/")
	rel = filepath.FromSlash(rel)
	abs := filepath.Join(root, rel)
	cleaned := filepath.Clean(abs)
	rootClean := filepath.Clean(root)
	rootPrefix := rootClean + string(filepath.Separator)
	if cleaned != rootClean && !strings.HasPrefix(cleaned+string(filepath.Separator), rootPrefix) {
		return "", ErrUnsafePath
	}

	resolvedRoot, err := filepath.EvalSymlinks(rootClean)
	if err != nil {
		return "", err
	}

	resolved, err := filepath.EvalSymlinks(cleaned)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		// note: destination doesn't exist yet (legitimate for save/move
		// targets). Walk up to the nearest existing ancestor and verify it
		// — and every intermediate symlink — still resolves inside root.
		ancestor := cleaned
		for {
			parent := filepath.Dir(ancestor)
			if parent == ancestor {
				return "", ErrUnsafePath
			}
			ancestor = parent
			if _, statErr := os.Lstat(ancestor); statErr != nil {
				if errors.Is(statErr, fs.ErrNotExist) {
					continue
				}
				return "", statErr
			}
			resolvedAncestor, evalErr := filepath.EvalSymlinks(ancestor)
			if evalErr != nil {
				if errors.Is(evalErr, fs.ErrNotExist) {
					continue
				}
				return "", evalErr
			}
			if resolvedAncestor != resolvedRoot && !strings.HasPrefix(resolvedAncestor+string(filepath.Separator), resolvedRoot+string(filepath.Separator)) {
				return "", ErrUnsafePath
			}
			return cleaned, nil
		}
	}
	if resolved != resolvedRoot && !strings.HasPrefix(resolved+string(filepath.Separator), resolvedRoot+string(filepath.Separator)) {
		return "", ErrUnsafePath
	}
	return cleaned, nil
}

// RelFromAbs is the inverse of SafeJoin: returns the forward-slash relative
// path of abs under root, or an error if abs is outside root.
func RelFromAbs(root, abs string) (string, error) {
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(abs))
	if err != nil {
		return "", err
	}
	if rel == "." {
		return "", nil
	}
	if strings.HasPrefix(rel, "..") {
		return "", ErrUnsafePath
	}
	return filepath.ToSlash(rel), nil
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	WriteJSONError(w, status, msg)
}

// WriteJSONError emits the package-standard error envelope; callers outside
// this package (the server middleware) use this to keep responses uniform.
func WriteJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"error":"` + jsonEscape(msg) + `"}`))
}

func jsonEscape(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch r {
		case '\\', '"':
			b.WriteByte('\\')
			b.WriteRune(r)
		case '\n':
			b.WriteString("\\n")
		case '\r':
			b.WriteString("\\r")
		case '\t':
			b.WriteString("\\t")
		default:
			if r < 0x20 {
				continue
			}
			b.WriteRune(r)
		}
	}
	return b.String()
}

// trimAPIPrefix strips a known /api/foo/ prefix from r.URL.Path and returns
// the remainder. Returns "" if the prefix doesn't match.
func trimAPIPrefix(r *http.Request, prefix string) string {
	p := r.URL.Path
	if !strings.HasPrefix(p, prefix) {
		return ""
	}
	return strings.TrimPrefix(p, prefix)
}

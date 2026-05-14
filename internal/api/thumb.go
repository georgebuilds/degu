package api

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// ThumbHandler returns a 256-px thumbnail for the file at /api/thumb/{path}.
//
// macOS-only for now: shells out to qlmanage(1) which returns the same image
// Finder/QuickLook would render — works for all media types macOS knows about
// (images, video, even some PDF/RAW). Cached on disk in the user cache dir,
// keyed by content fingerprint (path + size + mtime) so renames re-use the
// same thumbnail and edits invalidate it.
func ThumbHandler(root string) http.Handler {
	const prefix = "/api/thumb/"
	cache := newThumbCache()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := trimAPIPrefix(r, prefix)
		if rel == "" {
			writeJSONError(w, http.StatusBadRequest, "thumb: missing path")
			return
		}
		abs, err := SafeJoin(root, rel)
		if err != nil {
			writeJSONError(w, http.StatusForbidden, err.Error())
			return
		}
		info, err := os.Stat(abs)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				writeJSONError(w, http.StatusNotFound, "thumb: "+rel)
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}

		size := 256
		if v := r.URL.Query().Get("w"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1024 {
				size = n
			}
		}

		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()

		thumbPath, err := cache.get(ctx, abs, info, size)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "thumb: "+err.Error())
			return
		}

		f, err := os.Open(thumbPath)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer f.Close()
		thumbInfo, err := f.Stat()
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		// See file.go: relax the SPA-shell CORP for media-style bytes.
		w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
		http.ServeContent(w, r, "thumb.png", thumbInfo.ModTime(), f)
	})
}

// thumbCache serialises concurrent generation for the same file via per-key
// singleflight, and stores results under os.UserCacheDir.
type thumbCache struct {
	dir   string
	mu    sync.Mutex
	inFly map[string]*thumbCall
}

type thumbCall struct {
	done chan struct{}
	path string
	err  error
}

func newThumbCache() *thumbCache {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "com.georgebuilds.degu", "thumbs")
	_ = os.MkdirAll(dir, 0o755)
	return &thumbCache{dir: dir, inFly: map[string]*thumbCall{}}
}

func (c *thumbCache) key(absPath string, info os.FileInfo, size int) string {
	h := sha1.New()
	fmt.Fprintf(h, "%s\x00%d\x00%d\x00%d", absPath, info.Size(), info.ModTime().UnixNano(), size)
	return hex.EncodeToString(h.Sum(nil))
}

func (c *thumbCache) get(ctx context.Context, absPath string, info os.FileInfo, size int) (string, error) {
	key := c.key(absPath, info, size)
	out := filepath.Join(c.dir, key+".png")

	if _, err := os.Stat(out); err == nil {
		return out, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}

	c.mu.Lock()
	if call, ok := c.inFly[key]; ok {
		c.mu.Unlock()
		select {
		case <-call.done:
			return call.path, call.err
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	call := &thumbCall{done: make(chan struct{})}
	c.inFly[key] = call
	c.mu.Unlock()

	go func() {
		defer close(call.done)
		// note: don't tie generation to the first caller's request ctx —
		// if they cancel, all waiters fail. Use a fresh context with our
		// own timeout so other waiters still get the result.
		genCtx, genCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer genCancel()
		err := generateThumbnail(genCtx, absPath, out, size)
		c.mu.Lock()
		if err != nil {
			call.err = err
		} else {
			call.path = out
		}
		delete(c.inFly, key)
		c.mu.Unlock()
	}()

	select {
	case <-call.done:
		return call.path, call.err
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// generateThumbnail invokes qlmanage(1) and renames its output into place.
//
// qlmanage writes to a directory we control: <out>.dir/<basename>.png. We
// then move that into the cache slot so a partial run never leaves a
// half-written cache file.
func generateThumbnail(ctx context.Context, src, out string, size int) error {
	tmpDir, err := os.MkdirTemp(filepath.Dir(out), "ql-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	cmd := exec.CommandContext(ctx, "qlmanage",
		"-t",
		"-s", strconv.Itoa(size),
		"-o", tmpDir,
		src,
	)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("qlmanage failed: %w (%s)", err, string(output))
	}

	// qlmanage names the output "<basename>.png".
	base := filepath.Base(src) + ".png"
	produced := filepath.Join(tmpDir, base)
	if _, err := os.Stat(produced); err != nil {
		// Some files yield no thumbnail (e.g. truncated mp4); produce a 1x1
		// transparent placeholder so the SPA can still get a valid 200 and
		// stop retrying.
		return os.WriteFile(out, transparentPNG, 0o644)
	}
	return os.Rename(produced, out)
}

// 1x1 transparent PNG. Hand-encoded to avoid pulling image/png.
var transparentPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
	0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
}

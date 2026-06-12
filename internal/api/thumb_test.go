package api

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// thumbQLManageWorks reports whether qlmanage(1) is available AND actually
// runnable in this environment. Thumbnail generation shells out to it and is
// macOS-only; some sandboxes have the binary but kill it on exec, so we probe
// a real invocation before relying on it.
func thumbQLManageWorks(t *testing.T) bool {
	t.Helper()
	if _, err := exec.LookPath("qlmanage"); err != nil {
		return false
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "probe.png")
	if err := os.WriteFile(src, transparentPNG, 0o644); err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "qlmanage", "-t", "-s", "32", "-o", dir, src)
	// If the process can't even run (sandbox kill, missing perms), skip.
	return cmd.Run() == nil
}

func TestThumbMissingPathIsBadRequest(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(ThumbHandler(root))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/thumb/")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400", res.StatusCode)
	}
}

func TestThumbTraversalIsForbidden(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(filepath.Dir(root), "thumb-secret.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(outside)

	srv := httptest.NewServer(ThumbHandler(root))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/thumb/../" + filepath.Base(outside))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK {
		t.Errorf("traversal succeeded — status %d", res.StatusCode)
	}
}

func TestThumbNotFound(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(ThumbHandler(root))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/thumb/nope.jpg")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", res.StatusCode)
	}
}

func TestThumbCacheKeyVariesWithSizeAndContent(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "a.jpg")
	if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	c := newThumbCache()
	k256 := c.key(p, info, 256)
	k512 := c.key(p, info, 512)
	if k256 == k512 {
		t.Errorf("key should vary with size")
	}
	if k256 == c.key(filepath.Join(root, "b.jpg"), info, 256) {
		t.Errorf("key should vary with path")
	}
}

func TestThumbCacheReturnsCachedFileWithoutGenerating(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "a.jpg")
	if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	c := newThumbCache()
	// Pre-seed the cache slot so get() returns it directly without invoking
	// any external tool.
	key := c.key(p, info, 256)
	cached := filepath.Join(c.dir, key+".png")
	if err := os.WriteFile(cached, transparentPNG, 0o644); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(cached)

	got, err := c.get(context.Background(), p, info, 256)
	if err != nil {
		t.Fatal(err)
	}
	if got != cached {
		t.Errorf("get: got %q, want cached %q", got, cached)
	}
}

func TestThumbCacheGetRespectsCancelledContext(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "a.jpg")
	if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	c := newThumbCache()
	// Occupy the in-flight slot with a call that never completes, so get()
	// for the same key has to wait — then cancel and assert it returns the
	// context error rather than blocking.
	key := c.key(p, info, 256)
	c.mu.Lock()
	c.inFly[key] = &thumbCall{done: make(chan struct{})}
	c.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.get(ctx, p, info, 256); err == nil {
		t.Errorf("expected context error from cancelled get")
	}
}

func TestThumbCacheGetWaitsForInFlightResult(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "a.jpg")
	if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	c := newThumbCache()
	key := c.key(p, info, 256)
	out := filepath.Join(c.dir, key+".png")
	t.Cleanup(func() { os.Remove(out) })

	// Simulate an in-flight generation that completes with a result.
	call := &thumbCall{done: make(chan struct{})}
	c.mu.Lock()
	c.inFly[key] = call
	c.mu.Unlock()
	go func() {
		call.path = out
		close(call.done)
	}()

	got, err := c.get(context.Background(), p, info, 256)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got != out {
		t.Errorf("get returned %q, want in-flight result %q", got, out)
	}
}

func TestThumbServesCachedFileOverHTTP(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "a.jpg")
	if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	// Pre-seed cache so the handler serves bytes without generating.
	c := newThumbCache()
	key := c.key(p, info, 256)
	cached := filepath.Join(c.dir, key+".png")
	if err := os.WriteFile(cached, transparentPNG, 0o644); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(cached)

	srv := httptest.NewServer(ThumbHandler(root))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/thumb/a.jpg")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d, want 200", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type: got %q, want image/png", ct)
	}
	if corp := res.Header.Get("Cross-Origin-Resource-Policy"); corp != "cross-origin" {
		t.Errorf("CORP: got %q, want cross-origin", corp)
	}
	body := new(bytes.Buffer)
	_, _ = body.ReadFrom(res.Body)
	if !bytes.Equal(body.Bytes(), transparentPNG) {
		t.Errorf("body did not match cached PNG")
	}
}

func TestThumbGeneratesViaHandlerWhenQLManageWorks(t *testing.T) {
	if !thumbQLManageWorks(t) {
		t.Skip("qlmanage not available or not runnable in this environment")
	}
	root := t.TempDir()
	src := filepath.Join(root, "pixel.png")
	if err := os.WriteFile(src, transparentPNG, 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(ThumbHandler(root))
	defer srv.Close()

	// First request triggers generation (exercises get()'s goroutine path);
	// second hits the on-disk cache.
	for i := 0; i < 2; i++ {
		res, err := srv.Client().Get(srv.URL + "/api/thumb/pixel.png?w=64")
		if err != nil {
			t.Fatal(err)
		}
		body := new(bytes.Buffer)
		_, _ = body.ReadFrom(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("request %d: status %d", i, res.StatusCode)
		}
		if body.Len() == 0 {
			t.Errorf("request %d: empty thumbnail body", i)
		}
	}
}

func TestThumbWidthParamSelectsDistinctCacheSlot(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "a.jpg")
	if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	c := newThumbCache()
	// Seed the w=512 slot only.
	key512 := c.key(p, info, 512)
	cached := filepath.Join(c.dir, key512+".png")
	if err := os.WriteFile(cached, transparentPNG, 0o644); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(cached)

	srv := httptest.NewServer(ThumbHandler(root))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/thumb/a.jpg?w=512")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (w=512 slot was seeded)", res.StatusCode)
	}
}

func TestThumbInvalidWidthFallsBackToDefault(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "a.jpg")
	if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	c := newThumbCache()
	// Seed the default (256) slot; invalid/out-of-range w should use it.
	key := c.key(p, info, 256)
	cached := filepath.Join(c.dir, key+".png")
	if err := os.WriteFile(cached, transparentPNG, 0o644); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(cached)

	srv := httptest.NewServer(ThumbHandler(root))
	defer srv.Close()

	for _, w := range []string{"0", "-5", "9999", "abc"} {
		res, err := srv.Client().Get(srv.URL + "/api/thumb/a.jpg?w=" + w)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("w=%s: got %d, want 200 (should fall back to 256)", w, res.StatusCode)
		}
	}
}

func TestGenerateThumbnailPlaceholderForUnrenderable(t *testing.T) {
	if !thumbQLManageWorks(t) {
		t.Skip("qlmanage not available or not runnable in this environment")
	}
	root := t.TempDir()
	// A .txt file qlmanage typically produces no PNG for; generateThumbnail
	// must then write the transparent placeholder so the SPA gets a 200.
	src := filepath.Join(root, "empty.bin")
	if err := os.WriteFile(src, []byte{}, 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "out.png")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	err := generateThumbnail(ctx, src, out, 256)
	if err != nil {
		// Some environments kill qlmanage on an unrenderable input rather
		// than letting it exit 0-with-no-output; that's an env quirk, not a
		// code defect. The placeholder branch is exercised only when qlmanage
		// returns success without producing a PNG.
		if strings.Contains(err.Error(), "killed") {
			t.Skipf("qlmanage killed on unrenderable input: %v", err)
		}
		t.Fatalf("generateThumbnail: %v", err)
	}
	if _, err := os.Stat(out); err != nil {
		t.Fatalf("output not written: %v", err)
	}
}

func TestGenerateThumbnailRealImage(t *testing.T) {
	if !thumbQLManageWorks(t) {
		t.Skip("qlmanage not available or not runnable in this environment")
	}
	root := t.TempDir()
	src := filepath.Join(root, "pixel.png")
	if err := os.WriteFile(src, transparentPNG, 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "out.png")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := generateThumbnail(ctx, src, out, 64); err != nil {
		t.Fatalf("generateThumbnail: %v", err)
	}
	fi, err := os.Stat(out)
	if err != nil || fi.Size() == 0 {
		t.Fatalf("output missing or empty: %v", err)
	}
}

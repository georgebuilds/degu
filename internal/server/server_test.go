package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/georgebuilds/degu/internal/db"
)

func writeFile(dir, name, body string) error {
	return os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644)
}

func TestHealthz(t *testing.T) {
	srv := New(Config{Root: "/tmp", Version: "test"})
	req := httptest.NewRequest("GET", "/api/healthz", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("body: got %q", rec.Body.String())
	}
}

func TestCrossOriginIsolationHeaders(t *testing.T) {
	srv := New(Config{Root: "/tmp", Version: "test"})
	req := httptest.NewRequest("GET", "/api/healthz", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	wantHeaders := map[string]string{
		"Cross-Origin-Opener-Policy":   "same-origin",
		"Cross-Origin-Embedder-Policy": "require-corp",
		"Cross-Origin-Resource-Policy": "same-origin",
	}
	for k, v := range wantHeaders {
		if got := rec.Header().Get(k); got != v {
			t.Errorf("%s: got %q, want %q", k, got, v)
		}
	}
}

func TestRootServesHTML(t *testing.T) {
	srv := New(Config{Root: "/tmp", Version: "test"})
	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	// In CI / pre-build state we serve the placeholder with 503; once `make
	// build` has populated index.html we'd return 200. Either way it's HTML.
	if rec.Code != http.StatusOK && rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d, want 200 or 503", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("content-type: got %q, want text/html...", ct)
	}
	if !strings.Contains(rec.Body.String(), "<html") {
		t.Errorf("body should contain html element")
	}
}

func TestOriginGuardRejectsMissingOriginOnDelete(t *testing.T) {
	dir := t.TempDir()
	d, err := db.Open(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	srv := New(Config{Root: dir, Version: "test", DB: d, Port: 7878, EnableOriginGuard: true})
	h := srv.Handler()

	req := httptest.NewRequest(http.MethodDelete, "/api/file/x.jpg", nil)
	req.Host = "127.0.0.1:7878"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing-Origin DELETE: got %d, want 403", rec.Code)
	}
}

func TestOriginGuardRejectsForeignOriginOnDelete(t *testing.T) {
	dir := t.TempDir()
	d, err := db.Open(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	srv := New(Config{Root: dir, Version: "test", DB: d, Port: 7878, EnableOriginGuard: true})
	h := srv.Handler()

	req := httptest.NewRequest(http.MethodDelete, "/api/file/x.jpg", nil)
	req.Host = "127.0.0.1:7878"
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign-Origin DELETE: got %d, want 403", rec.Code)
	}
}

func TestOriginGuardAllowsLoopbackOriginOnDelete(t *testing.T) {
	dir := t.TempDir()
	d, err := db.Open(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	if err := writeFile(dir, "x.jpg", "hello"); err != nil {
		t.Fatal(err)
	}

	srv := New(Config{Root: dir, Version: "test", DB: d, Port: 7878, EnableOriginGuard: true})
	h := srv.Handler()

	req := httptest.NewRequest(http.MethodDelete, "/api/file/x.jpg", nil)
	req.Host = "127.0.0.1:7878"
	req.Header.Set("Origin", "http://127.0.0.1:7878")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("loopback-Origin DELETE: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
}

func TestOriginGuardRejectsForeignHost(t *testing.T) {
	dir := t.TempDir()
	d, err := db.Open(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	srv := New(Config{Root: dir, Version: "test", DB: d, Port: 7878, EnableOriginGuard: true})
	h := srv.Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/healthz", nil)
	req.Host = "evil.example"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign-Host GET: got %d, want 403", rec.Code)
	}
}

func TestInfoIncludesRoot(t *testing.T) {
	srv := New(Config{Root: "/tmp/photos", Version: "1.2.3"})
	req := httptest.NewRequest("GET", "/api/info", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	body := rec.Body.String()
	if !strings.Contains(body, `"root":"/tmp/photos"`) {
		t.Errorf("body missing root: %s", body)
	}
	if !strings.Contains(body, `"version":"1.2.3"`) {
		t.Errorf("body missing version: %s", body)
	}
}

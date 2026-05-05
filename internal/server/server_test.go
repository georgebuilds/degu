package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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

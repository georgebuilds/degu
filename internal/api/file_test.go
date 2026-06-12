package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/georgebuilds/degu/internal/db"
)

func TestFileMissingPathBadRequest(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(FileHandler(root, nil))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/file/")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400", res.StatusCode)
	}
}

func TestFileUnservableExtIs404(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(FileHandler(root, nil))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/file/note.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("status: got %d, want 404 (non-media ext)", res.StatusCode)
	}
}

func TestFileMissingFileIs404(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(FileHandler(root, nil))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/file/ghost.jpg")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", res.StatusCode)
	}
}

func TestFileDirectoryIsBadRequest(t *testing.T) {
	root := t.TempDir()
	// A directory with a servable-looking extension to get past the ext gate.
	if err := os.MkdirAll(filepath.Join(root, "folder.jpg"), 0o755); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(FileHandler(root, nil))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/file/folder.jpg")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400 (is a directory)", res.StatusCode)
	}
}

func TestFileSetsContentTypeAndETag(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "clip.mp4"), []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(FileHandler(root, nil))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/file/clip.mp4")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); ct != "video/mp4" {
		t.Errorf("Content-Type: got %q, want video/mp4", ct)
	}
	if res.Header.Get("ETag") == "" {
		t.Errorf("ETag missing")
	}
	if corp := res.Header.Get("Cross-Origin-Resource-Policy"); corp != "cross-origin" {
		t.Errorf("CORP: got %q, want cross-origin", corp)
	}
}

func TestFileDeleteRemovesFileAndTags(t *testing.T) {
	root := t.TempDir()
	d, err := db.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := os.WriteFile(filepath.Join(root, "a.jpg"), []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := db.SaveTagState(context.Background(), d, &db.TagState{
		Tags: map[string][]string{"a.jpg": {"keep"}},
	}); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(FileHandler(root, d))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/file/a.jpg", nil)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d, want 200", res.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(root, "a.jpg")); !os.IsNotExist(err) {
		t.Errorf("file should be deleted")
	}
	state, err := db.LoadTagState(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := state.Tags["a.jpg"]; ok {
		t.Errorf("tag rows should have been cleaned up: %v", state.Tags)
	}
}

func TestFileDeleteMissingIs404(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(FileHandler(root, nil))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/file/ghost.jpg", nil)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", res.StatusCode)
	}
}

func TestFileDeleteUnservableExtIs404(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(FileHandler(root, nil))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/file/note.txt", nil)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("status: got %d, want 404 (non-media ext)", res.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(root, "note.txt")); err != nil {
		t.Errorf("non-media file should be untouched: %v", err)
	}
}

func TestFileDeleteEmptyDirectory(t *testing.T) {
	root := t.TempDir()
	d, err := db.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	sub := filepath.Join(root, "emptydir")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := db.SaveTagState(context.Background(), d, &db.TagState{
		Tags: map[string][]string{"emptydir/x.jpg": {"t"}},
	}); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(FileHandler(root, d))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/file/emptydir", nil)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d, want 200", res.StatusCode)
	}
	if _, err := os.Stat(sub); !os.IsNotExist(err) {
		t.Errorf("empty dir should be removed")
	}
	state, _ := db.LoadTagState(context.Background(), d)
	if _, ok := state.Tags["emptydir/x.jpg"]; ok {
		t.Errorf("prefixed tag rows should be cleaned: %v", state.Tags)
	}
}

func TestFileDeleteNonEmptyDirectoryIsConflict(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "full")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "a.jpg"), []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(FileHandler(root, nil))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/file/full", nil)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusConflict {
		t.Errorf("status: got %d, want 409 (non-empty dir)", res.StatusCode)
	}
}

func TestMimeByExt(t *testing.T) {
	cases := map[string]string{
		"/x/a.mp4":  "video/mp4",
		"/x/a.m4v":  "video/mp4",
		"/x/a.mov":  "video/quicktime",
		"/x/a.webm": "video/webm",
		"/x/a.mkv":  "video/x-matroska",
		"/x/a.avi":  "video/x-msvideo",
		"/x/a.heic": "image/heic",
		"/x/a.avif": "image/avif",
	}
	for path, want := range cases {
		if got := mimeByExt(path); got != want {
			t.Errorf("mimeByExt(%q): got %q, want %q", path, got, want)
		}
	}
	// Unknown extension falls through to the stdlib mime db (may be "").
	_ = mimeByExt("/x/a.unknownext")
}

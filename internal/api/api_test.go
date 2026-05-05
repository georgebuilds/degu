package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/georgebuilds/degu/internal/db"
)

// fixtureRoot creates a tiny media tree under t.TempDir() and returns its path.
//
//	root/
//	  a.jpg          ← 5 bytes
//	  sub/
//	    clip.mp4     ← 11 bytes
//	    note.txt     ← skipped (not media)
//	  .hidden/x.jpg  ← skipped (hidden dir)
func fixtureRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(filepath.Join(root, "a.jpg"), []byte("hello"), 0o644))
	must(os.MkdirAll(filepath.Join(root, "sub"), 0o755))
	must(os.WriteFile(filepath.Join(root, "sub", "clip.mp4"), []byte("video bytes"), 0o644))
	must(os.WriteFile(filepath.Join(root, "sub", "note.txt"), []byte("ignored"), 0o644))
	must(os.MkdirAll(filepath.Join(root, ".hidden"), 0o755))
	must(os.WriteFile(filepath.Join(root, ".hidden", "x.jpg"), []byte("ignored"), 0o644))
	return root
}

func TestScanReturnsOnlyMedia(t *testing.T) {
	root := fixtureRoot(t)
	srv := httptest.NewServer(ScanHandler(root))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/scan")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	var got ScanResponse
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	paths := make([]string, 0, len(got.Entries))
	for _, e := range got.Entries {
		paths = append(paths, e.Path)
	}
	want := []string{"a.jpg", "sub/clip.mp4"}
	if !equalSlices(paths, want) {
		t.Errorf("paths: got %v, want %v", paths, want)
	}
	for _, e := range got.Entries {
		if e.Size <= 0 || e.ModTime <= 0 {
			t.Errorf("missing size/modTime: %+v", e)
		}
	}
}

func TestFileServesContent(t *testing.T) {
	root := fixtureRoot(t)
	srv := httptest.NewServer(FileHandler(root))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/file/a.jpg")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if string(body) != "hello" {
		t.Errorf("body: got %q, want %q", body, "hello")
	}
	if got := res.Header.Get("Accept-Ranges"); got != "bytes" {
		t.Errorf("Accept-Ranges: got %q, want bytes", got)
	}
}

func TestFileSubdirectoryAndRange(t *testing.T) {
	root := fixtureRoot(t)
	srv := httptest.NewServer(FileHandler(root))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/file/sub/clip.mp4", nil)
	req.Header.Set("Range", "bytes=0-4")
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusPartialContent {
		t.Errorf("status: got %d, want 206", res.StatusCode)
	}
	body, _ := io.ReadAll(res.Body)
	if string(body) != "video" {
		t.Errorf("body: got %q, want 'video'", body)
	}
}

func TestFileRejectsTraversal(t *testing.T) {
	root := fixtureRoot(t)
	parentSecret := filepath.Join(filepath.Dir(root), "secret.txt")
	if err := os.WriteFile(parentSecret, []byte("don't read me"), 0o644); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(parentSecret)

	srv := httptest.NewServer(FileHandler(root))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/file/../" + filepath.Base(parentSecret))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK {
		t.Errorf("traversal succeeded — status %d", res.StatusCode)
	}
}

func TestMoveRenamesFileAndTags(t *testing.T) {
	root := fixtureRoot(t)
	d, err := db.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := db.SaveTagState(context.Background(), d, &db.TagState{
		Tags:         map[string][]string{"a.jpg": {"family"}},
		LastReviewed: map[string]string{"a.jpg": "2024-01-01T00:00:00Z"},
	}); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	body := bytes.NewBufferString(`{"from":"a.jpg","to":"renamed.jpg"}`)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move", body)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d", res.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(root, "renamed.jpg")); err != nil {
		t.Errorf("renamed file missing: %v", err)
	}

	state, err := db.LoadTagState(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	if got := state.Tags["renamed.jpg"]; len(got) != 1 || got[0] != "family" {
		t.Errorf("tags didn't follow rename: %v", state.Tags)
	}
	if state.LastReviewed["renamed.jpg"] == "" {
		t.Errorf("lastReviewed didn't follow rename: %v", state.LastReviewed)
	}
	if _, ok := state.Tags["a.jpg"]; ok {
		t.Errorf("tags should have been moved off old key")
	}
}

func TestMoveRefusesOverwrite(t *testing.T) {
	root := fixtureRoot(t)
	d, err := db.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	if err := os.WriteFile(filepath.Join(root, "b.jpg"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"from":"a.jpg","to":"b.jpg"}`)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move", body)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK {
		t.Errorf("expected non-200 (overwrite refused), got 200")
	}
}

func TestSaveWritesNewFile(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/save/new/clip.mp4",
		bytes.NewReader([]byte("payload")))
	req.Header.Set("Content-Type", "video/mp4")
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d", res.StatusCode)
	}
	got, err := os.ReadFile(filepath.Join(root, "new", "clip.mp4"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "payload" {
		t.Errorf("contents: got %q, want payload", got)
	}
}

func TestSaveRefusesOverwriteUnlessAsked(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "exists.mp4"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	put := func(url, body string) int {
		req, _ := http.NewRequest(http.MethodPut, url, strings.NewReader(body))
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		return res.StatusCode
	}
	if put(srv.URL+"/api/save/exists.mp4", "nope") != http.StatusConflict {
		t.Errorf("expected 409 without overwrite=1")
	}
	if put(srv.URL+"/api/save/exists.mp4?overwrite=1", "new") != http.StatusOK {
		t.Errorf("expected 200 with overwrite=1")
	}
	got, _ := os.ReadFile(filepath.Join(root, "exists.mp4"))
	if string(got) != "new" {
		t.Errorf("file contents: got %q, want 'new'", got)
	}
}

func TestStatsBreakdowns(t *testing.T) {
	root := fixtureRoot(t)
	d, err := db.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := db.SaveTagState(context.Background(), d, &db.TagState{
		Tags: map[string][]string{
			"a.jpg":        {"family"},
			"sub/clip.mp4": {"family", "trip"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(StatsHandler(root, d))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/stats")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	var got StatsResponse
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.TotalFiles != 2 {
		t.Errorf("TotalFiles: got %d, want 2", got.TotalFiles)
	}
	if got.ByKind.Image == 0 || got.ByKind.Video == 0 {
		t.Errorf("byKind missing data: %+v", got.ByKind)
	}
	tagBytes := map[string]int64{}
	for _, t := range got.ByTag {
		tagBytes[t.Tag] = t.Bytes
	}
	if tagBytes["family"] == 0 || tagBytes["trip"] == 0 {
		t.Errorf("byTag missing rows: %+v", got.ByTag)
	}
}

func equalSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

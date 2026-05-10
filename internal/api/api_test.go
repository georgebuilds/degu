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
	srv := httptest.NewServer(FileHandler(root, nil))
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
	srv := httptest.NewServer(FileHandler(root, nil))
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

	srv := httptest.NewServer(FileHandler(root, nil))
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

func TestSafeJoinRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(filepath.Dir(root), "outside-secret.txt")
	if err := os.WriteFile(target, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(target)

	link := filepath.Join(root, "link.jpg")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unsupported in this environment: %v", err)
	}

	if _, err := SafeJoin(root, "link.jpg"); err == nil {
		t.Fatal("SafeJoin should reject path that resolves through a symlink to outside root")
	}
}

func TestSafeJoinAllowsNonExistent(t *testing.T) {
	root := t.TempDir()
	got, err := SafeJoin(root, "future/save.mp4")
	if err != nil {
		t.Fatalf("SafeJoin on non-existent path: got %v, want nil", err)
	}
	want := filepath.Join(root, "future", "save.mp4")
	if got != want {
		t.Fatalf("SafeJoin: got %q, want %q", got, want)
	}
}

func TestDeleteDirectoryTagsDoesNotOvermatchUnderscore(t *testing.T) {
	root := t.TempDir()
	d, err := db.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	// Both "a_b/foo.png" and "axb/foo.png" — LIKE 'a_b/%' would match both
	// because `_` is a single-char wildcard in SQL LIKE.
	if err := db.SaveTagState(context.Background(), d, &db.TagState{
		Tags: map[string][]string{
			"a_b/foo.png": {"keep-me"},
			"axb/foo.png": {"sibling"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	if err := os.MkdirAll(filepath.Join(root, "a_b"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := deleteTagRowsForPath(context.Background(), d, "a_b", true); err != nil {
		t.Fatal(err)
	}

	state, err := db.LoadTagState(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := state.Tags["a_b/foo.png"]; ok {
		t.Errorf("a_b/foo.png tags should have been deleted")
	}
	if got := state.Tags["axb/foo.png"]; len(got) != 1 || got[0] != "sibling" {
		t.Errorf("axb/foo.png tags should have survived: %v", state.Tags)
	}
}

func TestSafeJoinRejectsParentSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()

	// Symlink a directory under root to a directory outside root, then try
	// to write to a non-existent child beneath the symlink.
	link := filepath.Join(root, "linkdir")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks unsupported in this environment: %v", err)
	}

	if _, err := SafeJoin(root, "linkdir/new.mp4"); err == nil {
		t.Fatal("SafeJoin should reject a non-existent dest under a parent symlink that escapes root")
	}
}

func TestMovePartialFailureRollsBackRenames(t *testing.T) {
	root := t.TempDir()
	d, err := db.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	if err := os.WriteFile(filepath.Join(root, "a.jpg"), []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.jpg"), []byte("B"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "blocker.jpg"), []byte("X"), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	body := bytes.NewBufferString(`{"moves":[
		{"from":"a.jpg","to":"a-renamed.jpg"},
		{"from":"b.jpg","to":"blocker.jpg"}
	]}`)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move/batch", body)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode == http.StatusOK {
		t.Fatalf("expected non-200 for failing batch, got 200")
	}

	if _, err := os.Stat(filepath.Join(root, "a.jpg")); err != nil {
		t.Errorf("a.jpg should have been restored after partial failure: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "a-renamed.jpg")); !os.IsNotExist(err) {
		t.Errorf("a-renamed.jpg should not exist after rollback (err=%v)", err)
	}
}

// The FSA driver persists tag/loop/timestamp state to <root>/index.json.
// The HTTP API must refuse to serve, save, or delete that file (and its
// .tmp/.bak siblings); otherwise a same-origin request can wipe or clobber
// the entire tag store.
func TestFileGuardsReservedFilenames(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"index.json", "index.json.tmp", "index.json.bak", "degu.db", "degu.db-wal"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	srv := httptest.NewServer(FileHandler(root, nil))
	defer srv.Close()

	check := func(method, name string) {
		t.Helper()
		req, _ := http.NewRequest(method, srv.URL+"/api/file/"+name, nil)
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode == http.StatusOK {
			t.Errorf("%s /api/file/%s: expected refusal, got 200", method, name)
		}
		if _, err := os.Stat(filepath.Join(root, name)); err != nil {
			t.Errorf("%s /api/file/%s: file should still exist on disk: %v", method, name, err)
		}
	}
	for _, name := range []string{"index.json", "index.json.tmp", "index.json.bak", "degu.db", "degu.db-wal"} {
		check(http.MethodGet, name)
		check(http.MethodDelete, name)
	}
}

func TestSaveGuardsReservedFilenames(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"index.json", "index.json.tmp", "index.json.bak", "degu.db"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("original"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	for _, name := range []string{"index.json", "index.json.tmp", "index.json.bak", "degu.db"} {
		req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/save/"+name+"?overwrite=1",
			strings.NewReader("clobbered"))
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode == http.StatusOK {
			t.Errorf("PUT /api/save/%s: expected refusal, got 200", name)
		}
		got, _ := os.ReadFile(filepath.Join(root, name))
		if string(got) != "original" {
			t.Errorf("PUT /api/save/%s: contents changed to %q (reserved filename should be untouchable)", name, got)
		}
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

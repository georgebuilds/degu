package api

import (
	"bytes"
	"context"
	"net/http"
	"database/sql"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/georgebuilds/degu/internal/db"
)

// moveTestDB opens a degu.db under root and registers cleanup.
func moveTestDB(t *testing.T, root string) *sql.DB {
	t.Helper()
	d, err := db.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestMoveRejectsMalformedJSON(t *testing.T) {
	root := t.TempDir()
	d := moveTestDB(t, root)
	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	body := bytes.NewBufferString(`{"from":"a.jpg",`) // truncated
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move", body)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400", res.StatusCode)
	}
}

func TestMoveRejectsUnknownFields(t *testing.T) {
	root := t.TempDir()
	d := moveTestDB(t, root)
	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	body := bytes.NewBufferString(`{"from":"a.jpg","to":"b.jpg","extra":1}`)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move", body)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400 (unknown field)", res.StatusCode)
	}
}

func TestMoveMissingFields(t *testing.T) {
	root := t.TempDir()
	d := moveTestDB(t, root)
	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	cases := []string{
		`{"from":"","to":"b.jpg"}`,
		`{"from":"a.jpg","to":""}`,
	}
	for _, c := range cases {
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move", bytes.NewBufferString(c))
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode == http.StatusOK {
			t.Errorf("%s: expected non-200", c)
		}
	}
}

func TestMoveFromEqualsTo(t *testing.T) {
	root := t.TempDir()
	d := moveTestDB(t, root)
	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move",
		bytes.NewBufferString(`{"from":"a.jpg","to":"a.jpg"}`))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK {
		t.Errorf("from==to should be rejected, got 200")
	}
}

func TestMoveNonExistentSourceIsNotFound(t *testing.T) {
	root := t.TempDir()
	d := moveTestDB(t, root)
	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move",
		bytes.NewBufferString(`{"from":"ghost.jpg","to":"there.jpg"}`))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", res.StatusCode)
	}
}

func TestMoveTraversalIsForbidden(t *testing.T) {
	root := t.TempDir()
	d := moveTestDB(t, root)
	if err := os.WriteFile(filepath.Join(root, "a.jpg"), []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move",
		bytes.NewBufferString(`{"from":"a.jpg","to":"../escape.jpg"}`))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Errorf("status: got %d, want 403", res.StatusCode)
	}
}

func TestMoveBatchDuplicateFrom(t *testing.T) {
	root := t.TempDir()
	d := moveTestDB(t, root)
	if err := os.WriteFile(filepath.Join(root, "a.jpg"), []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	body := bytes.NewBufferString(`{"moves":[
		{"from":"a.jpg","to":"x.jpg"},
		{"from":"a.jpg","to":"y.jpg"}
	]}`)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move/batch", body)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK {
		t.Errorf("duplicate from in batch should be rejected, got 200")
	}
}

func TestMoveBatchSuccess(t *testing.T) {
	root := t.TempDir()
	d := moveTestDB(t, root)
	if err := os.WriteFile(filepath.Join(root, "a.jpg"), []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.jpg"), []byte("B"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := db.SaveTagState(context.Background(), d, &db.TagState{
		Tags: map[string][]string{"a.jpg": {"t1"}},
	}); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	body := bytes.NewBufferString(`{"moves":[
		{"from":"a.jpg","to":"a2.jpg"},
		{"from":"b.jpg","to":"b2.jpg"}
	]}`)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move/batch", body)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d, want 200", res.StatusCode)
	}
	for _, name := range []string{"a2.jpg", "b2.jpg"} {
		if _, err := os.Stat(filepath.Join(root, name)); err != nil {
			t.Errorf("%s missing after batch move: %v", name, err)
		}
	}
	state, err := db.LoadTagState(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	if got := state.Tags["a2.jpg"]; len(got) != 1 || got[0] != "t1" {
		t.Errorf("tags didn't follow batch rename: %v", state.Tags)
	}
}

func TestMoveBatchRejectsMalformedJSON(t *testing.T) {
	root := t.TempDir()
	d := moveTestDB(t, root)
	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move/batch",
		bytes.NewBufferString(`{not json`))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400", res.StatusCode)
	}
}

func TestRenameNoOverwriteRefusesExisting(t *testing.T) {
	root := t.TempDir()
	from := filepath.Join(root, "from.jpg")
	to := filepath.Join(root, "to.jpg")
	if err := os.WriteFile(from, []byte("F"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(to, []byte("T"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := renameNoOverwrite(from, to); err == nil {
		t.Errorf("expected error renaming over existing dest")
	}
	// Originals untouched.
	if b, _ := os.ReadFile(to); string(b) != "T" {
		t.Errorf("dest was clobbered: %q", b)
	}
}

func TestRenameNoOverwriteSucceeds(t *testing.T) {
	root := t.TempDir()
	from := filepath.Join(root, "from.jpg")
	to := filepath.Join(root, "to.jpg")
	if err := os.WriteFile(from, []byte("F"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := renameNoOverwrite(from, to); err != nil {
		t.Fatalf("renameNoOverwrite: %v", err)
	}
	if b, _ := os.ReadFile(to); string(b) != "F" {
		t.Errorf("dest contents: got %q, want F", b)
	}
	if _, err := os.Stat(from); !os.IsNotExist(err) {
		t.Errorf("source should be gone")
	}
}

func TestMoveDBBeginTxFailureIsServerError(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.jpg"), []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	d, err := db.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	d.Close() // closed handle: BeginTx will fail.

	srv := httptest.NewServer(MoveHandler(root, d))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/move",
		bytes.NewBufferString(`{"from":"a.jpg","to":"a2.jpg"}`))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusInternalServerError {
		t.Errorf("status: got %d, want 500 (closed DB)", res.StatusCode)
	}
	// The rename must not have happened since the tx couldn't begin.
	if _, err := os.Stat(filepath.Join(root, "a.jpg")); err != nil {
		t.Errorf("source should be intact when tx fails to begin: %v", err)
	}
}

func TestItoa(t *testing.T) {
	cases := map[int]string{
		0: "0", 1: "1", 9: "9", 10: "10", 255: "255",
		-1: "-1", -42: "-42",
	}
	for in, want := range cases {
		if got := itoa(in); got != want {
			t.Errorf("itoa(%d): got %q, want %q", in, got, want)
		}
	}
}

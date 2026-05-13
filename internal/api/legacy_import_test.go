package api

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/georgebuilds/degu/internal/db"
)

// openTempDB creates an empty SQLite DB in t.TempDir() with the same dir
// returned as `root`, so the legacy importer reads <root>/index.json and
// writes to <root>/degu.db.
func openTempDB(t *testing.T) (string, *sql.DB) {
	t.Helper()
	root := t.TempDir()
	d, err := db.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return root, d
}

func TestLegacyIndexStatus_Unavailable(t *testing.T) {
	root, d := openTempDB(t)
	srv := httptest.NewServer(LegacyIndexStatusHandler(root, d))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/legacy-index/status")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var got db.LegacyIndexStatus
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Available {
		t.Errorf("got Available=true; want false (no index.json)")
	}
}

func TestLegacyIndexStatus_Available(t *testing.T) {
	root, d := openTempDB(t)
	if err := os.WriteFile(filepath.Join(root, "index.json"),
		[]byte(`{"a.jpg":["t"],"b.jpg":["t"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(LegacyIndexStatusHandler(root, d))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/legacy-index/status")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var got db.LegacyIndexStatus
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if !got.Available || got.EntryCount != 2 {
		t.Errorf("got %+v; want Available=true EntryCount=2", got)
	}
}

func TestLegacyIndexImport_Streams(t *testing.T) {
	root, d := openTempDB(t)

	// Real file at a.jpg, fake reference to missing/b.jpg in the JSON.
	if err := os.WriteFile(filepath.Join(root, "a.jpg"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "index.json"),
		[]byte(`{"a.jpg":["t1","t2"],"missing/b.jpg":["t1"]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(LegacyIndexImportHandler(root, d))
	defer srv.Close()

	res, err := srv.Client().Post(srv.URL+"/api/legacy-index/import", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type: got %q, want text/event-stream", ct)
	}

	var events []legacyImportEvent
	scanner := bufio.NewScanner(res.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		var ev legacyImportEvent
		if err := json.Unmarshal([]byte(payload), &ev); err != nil {
			t.Fatalf("decode event %q: %v", payload, err)
		}
		events = append(events, ev)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}

	if len(events) == 0 {
		t.Fatal("no events received")
	}
	last := events[len(events)-1]
	if last.Type != "result" {
		t.Fatalf("last event type = %q, want result; events=%+v", last.Type, events)
	}
	if last.Result.Imported != 1 {
		t.Errorf("Imported = %d, want 1", last.Result.Imported)
	}
	if len(last.Result.Missing) != 1 || last.Result.Missing[0] != "missing/b.jpg" {
		t.Errorf("Missing = %v, want [missing/b.jpg]", last.Result.Missing)
	}

	// JSON should be removed.
	if _, err := os.Stat(filepath.Join(root, "index.json")); !os.IsNotExist(err) {
		t.Errorf("index.json should have been removed; stat err=%v", err)
	}
}

func TestLegacyIndexImport_RefusesPopulatedDB(t *testing.T) {
	root, d := openTempDB(t)
	if err := db.SaveTagState(context.Background(), d, &db.TagState{
		Tags:         map[string][]string{"x.jpg": {"t"}},
		VideoLoops:   map[string][]db.VideoLoop{},
		TagCreatedAt: map[string]string{},
		LastReviewed: map[string]string{},
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "index.json"),
		[]byte(`{"a.jpg":["t"]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(LegacyIndexImportHandler(root, d))
	defer srv.Close()

	res, err := srv.Client().Post(srv.URL+"/api/legacy-index/import", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		// The handler writes 200 then streams an error event; that's the
		// design (the connection is already upgraded to SSE before the
		// refusal kicks in).
		t.Errorf("status = %d, want 200 (errors arrive via SSE)", res.StatusCode)
	}
	scanner := bufio.NewScanner(res.Body)
	var sawError bool
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var ev legacyImportEvent
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &ev); err != nil {
			t.Fatal(err)
		}
		if ev.Type == "error" {
			sawError = true
		}
	}
	if !sawError {
		t.Errorf("expected an error event when DB is populated")
	}
}

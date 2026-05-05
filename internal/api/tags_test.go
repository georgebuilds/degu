package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/georgebuilds/degu/internal/db"
)

func TestTagsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	d, err := db.Open(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	srv := httptest.NewServer(TagsHandler(d))
	defer srv.Close()

	// PUT a state.
	body := `{
	  "tags": {"a/photo.jpg": ["family", "trip"]},
	  "videoLoops": {"b/clip.mp4": [{"id":"L1","startSec":1.5,"endSec":4.25}]},
	  "tagCreatedAt": {"family": "2024-04-12T18:42:00.000Z"},
	  "lastReviewed": {"a/photo.jpg": "2024-04-13T10:00:00.000Z"}
	}`
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/tags", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("PUT status: got %d, want 200", res.StatusCode)
	}
	res.Body.Close()

	// GET it back.
	res, err = srv.Client().Get(srv.URL + "/api/tags")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET status: got %d, want 200", res.StatusCode)
	}

	var got db.TagState
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Tags["a/photo.jpg"]) != 2 {
		t.Errorf("Tags[a/photo.jpg]: got %v, want 2 entries", got.Tags["a/photo.jpg"])
	}
	if got.TagCreatedAt["family"] == "" {
		t.Errorf("TagCreatedAt[family] missing")
	}
	loops := got.VideoLoops["b/clip.mp4"]
	if len(loops) != 1 || loops[0].ID != "L1" {
		t.Errorf("VideoLoops[b/clip.mp4]: got %+v", loops)
	}
}

func TestTagsRejectsUnknownFields(t *testing.T) {
	dir := t.TempDir()
	d, err := db.Open(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	srv := httptest.NewServer(TagsHandler(d))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/tags",
		bytes.NewBufferString(`{"weird":"field"}`))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400 for unknown field", res.StatusCode)
	}
}

func TestEmptyStateReturnsObjects(t *testing.T) {
	dir := t.TempDir()
	d, err := db.Open(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	srv := httptest.NewServer(TagsHandler(d))
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/api/tags")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	body, _ := io.ReadAll(res.Body)
	// Critical: maps must serialise as `{}` not `null` so the SPA can
	// dereference safely.
	for _, k := range []string{`"tags":{}`, `"videoLoops":{}`, `"tagCreatedAt":{}`, `"lastReviewed":{}`} {
		if !strings.Contains(string(body), k) {
			t.Errorf("response missing %s; body=%s", k, body)
		}
	}
}

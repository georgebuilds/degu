package db

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"testing"
)

func TestRoundTripFullState(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	d, err := Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	in := &TagState{
		Tags: map[string][]string{
			"a/photo.jpg":  {"family", "trip"},
			"b/clip.mp4":   {"work"},
			"empty/dir.md": {}, // dropped on round-trip (no tags)
		},
		VideoLoops: map[string][]VideoLoop{
			"b/clip.mp4": {
				{ID: "L1", StartSec: 1.5, EndSec: 4.25},
				{ID: "L2", StartSec: 10, EndSec: 12.5},
			},
		},
		TagCreatedAt: map[string]string{
			"family": "2024-04-12T18:42:00.000Z",
			"trip":   "2024-04-13T09:00:00.000Z",
		},
		LastReviewed: map[string]string{
			"a/photo.jpg": "2024-04-13T10:00:00.000Z",
		},
	}
	if err := SaveTagState(ctx, d, in); err != nil {
		t.Fatal(err)
	}

	out, err := LoadTagState(ctx, d)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range out.Tags {
		sort.Strings(v)
	}
	delete(in.Tags, "empty/dir.md") // expected drop
	for _, v := range in.Tags {
		sort.Strings(v)
	}
	if !reflect.DeepEqual(out.Tags, in.Tags) {
		t.Errorf("Tags: got %#v, want %#v", out.Tags, in.Tags)
	}
	if !reflect.DeepEqual(out.TagCreatedAt, in.TagCreatedAt) {
		t.Errorf("TagCreatedAt: got %#v, want %#v", out.TagCreatedAt, in.TagCreatedAt)
	}
	if !reflect.DeepEqual(out.LastReviewed, in.LastReviewed) {
		t.Errorf("LastReviewed: got %#v, want %#v", out.LastReviewed, in.LastReviewed)
	}
	got := out.VideoLoops["b/clip.mp4"]
	sort.Slice(got, func(i, j int) bool { return got[i].ID < got[j].ID })
	want := in.VideoLoops["b/clip.mp4"]
	if !reflect.DeepEqual(got, want) {
		t.Errorf("VideoLoops: got %#v, want %#v", got, want)
	}
}

func TestSaveReplacesEntireState(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	d, err := Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	if err := SaveTagState(ctx, d, &TagState{Tags: map[string][]string{"a": {"old"}}}); err != nil {
		t.Fatal(err)
	}
	if err := SaveTagState(ctx, d, &TagState{Tags: map[string][]string{"b": {"new"}}}); err != nil {
		t.Fatal(err)
	}
	out, err := LoadTagState(ctx, d)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := out.Tags["a"]; ok {
		t.Errorf("old key 'a' should have been deleted, got %v", out.Tags["a"])
	}
	if got := out.Tags["b"]; !reflect.DeepEqual(got, []string{"new"}) {
		t.Errorf("Tags[b]: got %v, want [new]", got)
	}
}

func TestIsEmpty(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	d, err := Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	empty, err := IsEmpty(ctx, d)
	if err != nil || !empty {
		t.Fatalf("IsEmpty: got (%v, %v), want (true, nil)", empty, err)
	}

	if err := SaveTagState(ctx, d, &TagState{Tags: map[string][]string{"x": {"t"}}}); err != nil {
		t.Fatal(err)
	}
	empty, err = IsEmpty(ctx, d)
	if err != nil || empty {
		t.Fatalf("IsEmpty after write: got (%v, %v), want (false, nil)", empty, err)
	}
}

func TestProbeLegacyIndex(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()

	d, err := Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	// No JSON, empty DB → unavailable.
	got, err := ProbeLegacyIndex(ctx, d, dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.Available {
		t.Errorf("no JSON: got Available=true")
	}

	legacy := `{
		"a/photo.jpg": ["family", "trip"],
		"./a/photo.jpg": ["family", "extra"],
		"b/clip.mp4": ["work"]
	}`
	if err := os.WriteFile(filepath.Join(dir, legacyIndexFilename), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err = ProbeLegacyIndex(ctx, d, dir)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Available {
		t.Errorf("JSON present, empty DB: got Available=false")
	}
	// Two distinct paths after canonicalisation (a/photo.jpg and b/clip.mp4).
	if got.EntryCount != 2 {
		t.Errorf("EntryCount: got %d, want 2 (after canonical-path merge)", got.EntryCount)
	}
}

func TestImportLegacyIndex_Verification(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()

	// Create a real file at a/photo.jpg, leave b/clip.mp4 absent.
	if err := os.MkdirAll(filepath.Join(dir, "a"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "a", "photo.jpg"), []byte("fake"), 0o644); err != nil {
		t.Fatal(err)
	}

	legacy := `{
		"a/photo.jpg": ["family", "trip"],
		"b/clip.mp4": ["work"],
		"__degu": {
			"videoLoops": {
				"b/clip.mp4": [{"id":"L1","startSec":1.5,"endSec":4.25}],
				"a/photo.jpg": [{"id":"K1","startSec":0,"endSec":2}]
			},
			"tagCreatedAt": {"family":"2024-04-12T18:42:00.000Z"},
			"lastReviewed": {
				"a/photo.jpg":"2024-04-13T10:00:00.000Z",
				"b/clip.mp4":"2024-04-13T10:00:00.000Z"
			}
		}
	}`
	if err := os.WriteFile(filepath.Join(dir, legacyIndexFilename), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}

	d, err := Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	res, err := ImportLegacyIndex(ctx, d, dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Imported != 1 {
		t.Errorf("Imported: got %d, want 1 (only a/photo.jpg exists)", res.Imported)
	}
	if len(res.Missing) != 1 || res.Missing[0] != "b/clip.mp4" {
		t.Errorf("Missing: got %v, want [b/clip.mp4]", res.Missing)
	}

	// JSON file should be deleted post-import.
	if _, err := os.Stat(filepath.Join(dir, legacyIndexFilename)); !os.IsNotExist(err) {
		t.Errorf("legacy JSON should have been removed; stat err=%v", err)
	}

	state, err := LoadTagState(ctx, d)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := state.Tags["b/clip.mp4"]; ok {
		t.Errorf("Tags should not contain unverified path b/clip.mp4")
	}
	if _, ok := state.VideoLoops["b/clip.mp4"]; ok {
		t.Errorf("VideoLoops should not contain unverified path b/clip.mp4")
	}
	if _, ok := state.LastReviewed["b/clip.mp4"]; ok {
		t.Errorf("LastReviewed should not contain unverified path b/clip.mp4")
	}
	if _, ok := state.LastReviewed["a/photo.jpg"]; !ok {
		t.Errorf("LastReviewed should retain verified path a/photo.jpg")
	}
}

func TestImportLegacyIndex_Dedup(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()

	if err := os.MkdirAll(filepath.Join(dir, "a"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "a", "photo.jpg"), []byte("fake"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Two keys canonicalising to the same path, with overlapping tags and
	// duplicates within each list.
	legacy := `{
		"a/photo.jpg":   ["family", "trip", "family"],
		"./a/photo.jpg": ["family", "extra", "  extra  "]
	}`
	if err := os.WriteFile(filepath.Join(dir, legacyIndexFilename), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}

	d, err := Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	if _, err := ImportLegacyIndex(ctx, d, dir, nil); err != nil {
		t.Fatal(err)
	}
	state, err := LoadTagState(ctx, d)
	if err != nil {
		t.Fatal(err)
	}
	got := state.Tags["a/photo.jpg"]
	sort.Strings(got)
	want := []string{"extra", "family", "trip"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Tags[a/photo.jpg]: got %v, want %v", got, want)
	}
}

func TestImportLegacyIndex_NoOpWhenDBPopulated(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	d, err := Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	// Pre-populate the DB so IsEmpty() is false.
	if err := SaveTagState(ctx, d, &TagState{
		Tags:         map[string][]string{"x.jpg": {"t"}},
		VideoLoops:   map[string][]VideoLoop{},
		TagCreatedAt: map[string]string{},
		LastReviewed: map[string]string{},
	}); err != nil {
		t.Fatal(err)
	}

	legacy := `{"a/photo.jpg":["family"]}`
	if err := os.WriteFile(filepath.Join(dir, legacyIndexFilename), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}

	// Probe should report unavailable when DB is populated.
	probe, err := ProbeLegacyIndex(ctx, d, dir)
	if err != nil {
		t.Fatal(err)
	}
	if probe.Available {
		t.Errorf("populated DB: ProbeLegacyIndex returned Available=true")
	}

	// Import should refuse.
	if _, err := ImportLegacyIndex(ctx, d, dir, nil); err == nil {
		t.Errorf("populated DB: ImportLegacyIndex should refuse, got nil error")
	}
}

func TestImportLegacyIndex_ProgressEvents(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()

	// 200 real files so the import emits progress mid-way through the
	// verify phase (the implementation reports every max(50, total/100)).
	for i := 0; i < 200; i++ {
		p := filepath.Join(dir, "f", "x"+strconv.Itoa(i)+".jpg")
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte{0x00}, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	jsonMap := map[string][]string{}
	for i := 0; i < 200; i++ {
		jsonMap["f/x"+strconv.Itoa(i)+".jpg"] = []string{"t"}
	}
	jsonBytes, _ := json.Marshal(jsonMap)
	if err := os.WriteFile(filepath.Join(dir, legacyIndexFilename), jsonBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	d, err := Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	var events []ImportProgress
	if _, err := ImportLegacyIndex(ctx, d, dir, func(p ImportProgress) {
		events = append(events, p)
	}); err != nil {
		t.Fatal(err)
	}

	if len(events) < 3 {
		t.Fatalf("expected at least 3 progress events, got %d", len(events))
	}
	if events[0].Phase != "verifying" || events[0].Done != 0 || events[0].Total != 200 {
		t.Errorf("first event = %+v, want {verifying 0 200}", events[0])
	}
	last := events[len(events)-1]
	if last.Phase != "done" || last.Done != 200 {
		t.Errorf("last event = %+v, want {done 200 200}", last)
	}
}

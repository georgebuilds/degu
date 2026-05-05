package db

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"sort"
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

func TestMaybeImportLegacyIndex(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()

	legacy := `{
		"a/photo.jpg": ["family", "trip"],
		"b/clip.mp4": ["work"],
		"__degu": {
			"videoLoops": {
				"b/clip.mp4": [
					{"id":"L1","startSec":1.5,"endSec":4.25},
					{"id":"bad","startSec":5,"endSec":5},
					{"id":"","startSec":6,"endSec":7}
				]
			},
			"tagCreatedAt": {"family":"2024-04-12T18:42:00.000Z"},
			"lastReviewed": {"a/photo.jpg":"2024-04-13T10:00:00.000Z"}
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

	imported, err := MaybeImportLegacyIndex(ctx, d, dir)
	if err != nil {
		t.Fatal(err)
	}
	if !imported {
		t.Fatalf("MaybeImportLegacyIndex: got false, want true")
	}

	state, err := LoadTagState(ctx, d)
	if err != nil {
		t.Fatal(err)
	}
	if got := state.Tags["a/photo.jpg"]; len(got) != 2 {
		t.Errorf("Tags[a/photo.jpg]: got %v, want 2 entries", got)
	}
	if got := state.VideoLoops["b/clip.mp4"]; len(got) != 1 {
		t.Errorf("VideoLoops[b/clip.mp4]: got %v, want 1 valid loop (the others should be dropped)", got)
	}
	if state.TagCreatedAt["family"] == "" {
		t.Errorf("TagCreatedAt[family] should be present")
	}

	// Calling again must be a no-op since the DB is no longer empty.
	imported2, err := MaybeImportLegacyIndex(ctx, d, dir)
	if err != nil {
		t.Fatal(err)
	}
	if imported2 {
		t.Errorf("second import should be skipped")
	}
}

func TestImportSkippedWhenLegacyMissing(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	d, err := Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	imported, err := MaybeImportLegacyIndex(ctx, d, dir)
	if err != nil {
		t.Fatal(err)
	}
	if imported {
		t.Errorf("nothing to import; got imported=true")
	}
}

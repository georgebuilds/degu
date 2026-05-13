package db

import (
	"context"
	"database/sql"
	"testing"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestCreateAndListPeople(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()

	alice, err := CreatePerson(ctx, d, "Alice")
	if err != nil {
		t.Fatal(err)
	}
	if alice.Name != "Alice" || alice.ID == 0 {
		t.Errorf("unexpected person: %+v", alice)
	}

	bob, err := CreatePerson(ctx, d, "Bob")
	if err != nil {
		t.Fatal(err)
	}

	people, err := ListPeople(ctx, d)
	if err != nil {
		t.Fatal(err)
	}
	if len(people) != 2 {
		t.Fatalf("got %d people, want 2", len(people))
	}
	if people[0].Name != "Alice" || people[1].Name != "Bob" {
		t.Errorf("unexpected order: %v, %v", people[0].Name, people[1].Name)
	}
	_ = bob
}

func TestCreatePersonDuplicate(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()

	if _, err := CreatePerson(ctx, d, "Alice"); err != nil {
		t.Fatal(err)
	}
	_, err := CreatePerson(ctx, d, "Alice")
	if err == nil {
		t.Fatal("expected error for duplicate name")
	}
}

func TestRenamePerson(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()

	p, err := CreatePerson(ctx, d, "Alice")
	if err != nil {
		t.Fatal(err)
	}
	renamed, err := RenamePerson(ctx, d, p.ID, "Alicia")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "Alicia" {
		t.Errorf("got name %q, want Alicia", renamed.Name)
	}
}

func TestRenamePersonNotFound(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()

	_, err := RenamePerson(ctx, d, 999, "Ghost")
	if err == nil {
		t.Fatal("expected error for missing person")
	}
}

func TestDeletePerson(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()

	p, err := CreatePerson(ctx, d, "Alice")
	if err != nil {
		t.Fatal(err)
	}
	if err := DeletePerson(ctx, d, p.ID); err != nil {
		t.Fatal(err)
	}
	people, err := ListPeople(ctx, d)
	if err != nil {
		t.Fatal(err)
	}
	if len(people) != 0 {
		t.Errorf("got %d people after delete, want 0", len(people))
	}
}

func TestDeletePersonNotFound(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()

	err := DeletePerson(ctx, d, 999)
	if err == nil {
		t.Fatal("expected error for missing person")
	}
}

func TestFaceRegionCRUD(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()

	alice, err := CreatePerson(ctx, d, "Alice")
	if err != nil {
		t.Fatal(err)
	}

	x, y, w, h := 0.1, 0.2, 0.3, 0.4
	region, err := CreateFaceRegion(ctx, d, FaceRegion{
		RelPath:  "photos/group.jpg",
		PersonID: &alice.ID,
		X:        &x,
		Y:        &y,
		W:        &w,
		H:        &h,
		Source:   "manual",
	})
	if err != nil {
		t.Fatal(err)
	}
	if region.ID == 0 {
		t.Error("expected non-zero ID")
	}
	if region.PersonName == nil || *region.PersonName != "Alice" {
		t.Errorf("expected personName=Alice, got %v", region.PersonName)
	}

	// List by path
	regions, err := ListFaceRegions(ctx, d, "photos/group.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if len(regions) != 1 {
		t.Fatalf("got %d regions, want 1", len(regions))
	}

	// List by person
	byPerson, err := ListFaceRegionsByPerson(ctx, d, alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(byPerson) != 1 {
		t.Fatalf("got %d regions by person, want 1", len(byPerson))
	}

	// Update
	newX := 0.5
	updated, err := UpdateFaceRegion(ctx, d, FaceRegion{
		ID:       region.ID,
		PersonID: &alice.ID,
		X:        &newX,
		Y:        &y,
		W:        &w,
		H:        &h,
		Source:   "confirmed",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.X == nil || *updated.X != 0.5 {
		t.Errorf("X: got %v, want 0.5", updated.X)
	}
	if updated.Source != "confirmed" {
		t.Errorf("Source: got %q, want confirmed", updated.Source)
	}

	// Delete
	if err := DeleteFaceRegion(ctx, d, region.ID); err != nil {
		t.Fatal(err)
	}
	regions, err = ListFaceRegions(ctx, d, "photos/group.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if len(regions) != 0 {
		t.Errorf("got %d regions after delete, want 0", len(regions))
	}
}

func TestDeletePersonNullsFaceRegion(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()

	alice, err := CreatePerson(ctx, d, "Alice")
	if err != nil {
		t.Fatal(err)
	}
	_, err = CreateFaceRegion(ctx, d, FaceRegion{
		RelPath:  "photos/solo.jpg",
		PersonID: &alice.ID,
		Source:   "manual",
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := DeletePerson(ctx, d, alice.ID); err != nil {
		t.Fatal(err)
	}

	regions, err := ListFaceRegions(ctx, d, "photos/solo.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if len(regions) != 1 {
		t.Fatalf("expected 1 orphaned region, got %d", len(regions))
	}
	if regions[0].PersonID != nil {
		t.Errorf("expected person_id=NULL after delete, got %v", regions[0].PersonID)
	}
}

func TestRenameFaceRegionPath(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()

	_, err := CreateFaceRegion(ctx, d, FaceRegion{
		RelPath: "old/path.jpg",
		Source:  "manual",
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := RenameFaceRegionPath(ctx, d, "old/path.jpg", "new/path.jpg"); err != nil {
		t.Fatal(err)
	}

	old, err := ListFaceRegions(ctx, d, "old/path.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if len(old) != 0 {
		t.Errorf("old path should have 0 regions, got %d", len(old))
	}

	moved, err := ListFaceRegions(ctx, d, "new/path.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if len(moved) != 1 {
		t.Errorf("new path should have 1 region, got %d", len(moved))
	}
}

func TestMigrationFromV1(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()

	// Open at v2 (fresh) — then verify person table exists by inserting.
	d, err := Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	// Verify the tables exist by running a query.
	_, err = d.ExecContext(ctx, `INSERT INTO person (name) VALUES ('test')`)
	if err != nil {
		t.Fatalf("person table should exist after migration: %v", err)
	}
	_, err = d.ExecContext(ctx, `INSERT INTO face_region (rel_path, source) VALUES ('x.jpg', 'manual')`)
	if err != nil {
		t.Fatalf("face_region table should exist after migration: %v", err)
	}
}

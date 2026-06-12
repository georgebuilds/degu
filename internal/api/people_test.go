package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/georgebuilds/degu/internal/db"
)

func setupPeopleServer(t *testing.T) (*httptest.Server, func()) {
	t.Helper()
	root := t.TempDir()
	d, err := db.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/people", PeopleHandler(d))
	mux.Handle("/api/people/", PeopleHandler(d))
	mux.Handle("/api/faces", FacesHandler(root, d))
	mux.Handle("/api/faces/", FacesHandler(root, d))
	srv := httptest.NewServer(mux)
	return srv, func() { srv.Close(); d.Close() }
}

func TestPeopleCRUD(t *testing.T) {
	srv, cleanup := setupPeopleServer(t)
	defer cleanup()

	// Create
	res, err := srv.Client().Post(srv.URL+"/api/people", "application/json",
		strings.NewReader(`{"name":"Alice"}`))
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create: got %d, want 201", res.StatusCode)
	}
	var alice db.Person
	json.NewDecoder(res.Body).Decode(&alice)
	res.Body.Close()
	if alice.Name != "Alice" || alice.ID == 0 {
		t.Errorf("unexpected: %+v", alice)
	}

	// List
	res, err = srv.Client().Get(srv.URL + "/api/people")
	if err != nil {
		t.Fatal(err)
	}
	var people []db.Person
	json.NewDecoder(res.Body).Decode(&people)
	res.Body.Close()
	if len(people) != 1 {
		t.Fatalf("list: got %d, want 1", len(people))
	}

	// Rename
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/people/"+i64str(alice.ID),
		strings.NewReader(`{"name":"Alicia"}`))
	req.Header.Set("Content-Type", "application/json")
	res, err = srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("rename: got %d, want 200", res.StatusCode)
	}
	var renamed db.Person
	json.NewDecoder(res.Body).Decode(&renamed)
	res.Body.Close()
	if renamed.Name != "Alicia" {
		t.Errorf("rename: got %q, want Alicia", renamed.Name)
	}

	// Delete
	req, _ = http.NewRequest(http.MethodDelete, srv.URL+"/api/people/"+i64str(alice.ID), nil)
	res, err = srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("delete: got %d, want 200", res.StatusCode)
	}
	res.Body.Close()

	// Verify empty
	res, _ = srv.Client().Get(srv.URL + "/api/people")
	json.NewDecoder(res.Body).Decode(&people)
	res.Body.Close()
	if len(people) != 0 {
		t.Errorf("after delete: got %d, want 0", len(people))
	}
}

func TestFacesCRUD(t *testing.T) {
	srv, cleanup := setupPeopleServer(t)
	defer cleanup()

	// Create a person first
	res, _ := srv.Client().Post(srv.URL+"/api/people", "application/json",
		strings.NewReader(`{"name":"Bob"}`))
	var bob db.Person
	json.NewDecoder(res.Body).Decode(&bob)
	res.Body.Close()

	// Create a face region
	body := `{"relPath":"photos/group.jpg","personId":` + i64str(bob.ID) + `,"x":0.1,"y":0.2,"w":0.3,"h":0.4}`
	res, err := srv.Client().Post(srv.URL+"/api/faces", "application/json",
		strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create face: got %d, want 201", res.StatusCode)
	}
	var region db.FaceRegion
	json.NewDecoder(res.Body).Decode(&region)
	res.Body.Close()
	if region.ID == 0 || region.PersonName == nil || *region.PersonName != "Bob" {
		t.Errorf("unexpected region: %+v", region)
	}

	// List by path
	res, _ = srv.Client().Get(srv.URL + "/api/faces?path=photos/group.jpg")
	var regions []db.FaceRegion
	json.NewDecoder(res.Body).Decode(&regions)
	res.Body.Close()
	if len(regions) != 1 {
		t.Fatalf("list: got %d, want 1", len(regions))
	}

	// List by person
	res, _ = srv.Client().Get(srv.URL + "/api/faces/by-person/" + i64str(bob.ID))
	json.NewDecoder(res.Body).Decode(&regions)
	res.Body.Close()
	if len(regions) != 1 {
		t.Fatalf("list by person: got %d, want 1", len(regions))
	}

	// Update
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/faces/"+i64str(region.ID),
		strings.NewReader(`{"personId":`+i64str(bob.ID)+`,"x":0.5,"y":0.2,"w":0.3,"h":0.4,"source":"confirmed"}`))
	req.Header.Set("Content-Type", "application/json")
	res, _ = srv.Client().Do(req)
	var updated db.FaceRegion
	json.NewDecoder(res.Body).Decode(&updated)
	res.Body.Close()
	if updated.X == nil || *updated.X != 0.5 {
		t.Errorf("update X: got %v, want 0.5", updated.X)
	}

	// Delete
	req, _ = http.NewRequest(http.MethodDelete, srv.URL+"/api/faces/"+i64str(region.ID), nil)
	res, _ = srv.Client().Do(req)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("delete face: got %d, want 200", res.StatusCode)
	}
	res.Body.Close()
}

func TestCreatePersonEmptyName(t *testing.T) {
	srv, cleanup := setupPeopleServer(t)
	defer cleanup()

	res, _ := srv.Client().Post(srv.URL+"/api/people", "application/json",
		strings.NewReader(`{"name":"  "}`))
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("empty name: got %d, want 400", res.StatusCode)
	}
	res.Body.Close()
}

func TestCreatePersonDuplicate(t *testing.T) {
	srv, cleanup := setupPeopleServer(t)
	defer cleanup()

	srv.Client().Post(srv.URL+"/api/people", "application/json",
		strings.NewReader(`{"name":"Alice"}`))
	res, _ := srv.Client().Post(srv.URL+"/api/people", "application/json",
		strings.NewReader(`{"name":"Alice"}`))
	if res.StatusCode != http.StatusConflict {
		t.Errorf("duplicate: got %d, want 409", res.StatusCode)
	}
	res.Body.Close()
}

func TestDeletePersonNotFound(t *testing.T) {
	srv, cleanup := setupPeopleServer(t)
	defer cleanup()

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/people/999", nil)
	res, _ := srv.Client().Do(req)
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("not found: got %d, want 404", res.StatusCode)
	}
	res.Body.Close()
}

func TestCreateFaceMissingPath(t *testing.T) {
	srv, cleanup := setupPeopleServer(t)
	defer cleanup()

	res, _ := srv.Client().Post(srv.URL+"/api/faces", "application/json",
		strings.NewReader(`{"personId":1}`))
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("missing path: got %d, want 400", res.StatusCode)
	}
	res.Body.Close()
}

func TestEmptyPeopleList(t *testing.T) {
	srv, cleanup := setupPeopleServer(t)
	defer cleanup()

	res, err := srv.Client().Get(srv.URL + "/api/people")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var people []db.Person
	json.NewDecoder(res.Body).Decode(&people)
	if len(people) != 0 {
		t.Errorf("empty list should have 0 entries, got %d", len(people))
	}
}

func TestListFacesPathEscape(t *testing.T) {
	srv, cleanup := setupPeopleServer(t)
	defer cleanup()

	res, err := srv.Client().Get(srv.URL + "/api/faces?path=../../escape")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("escaping path: got %d, want 400", res.StatusCode)
	}
}

func TestCreateFacePathEscape(t *testing.T) {
	srv, cleanup := setupPeopleServer(t)
	defer cleanup()

	body := `{"relPath":"../../etc/passwd","personId":1,"x":0.1,"y":0.2,"w":0.3,"h":0.4}`
	res, err := srv.Client().Post(srv.URL+"/api/faces", "application/json",
		strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("escaping relPath: got %d, want 400", res.StatusCode)
	}
}

func TestDecodeJSONBodyTooLarge(t *testing.T) {
	srv, cleanup := setupPeopleServer(t)
	defer cleanup()

	// Build a JSON body whose name field exceeds the 1 MiB MaxBytesReader limit.
	huge := strings.Repeat("a", (1<<20)+1024)
	body := `{"name":"` + huge + `"}`
	res, err := srv.Client().Post(srv.URL+"/api/people", "application/json",
		strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("oversized body: got %d, want 400", res.StatusCode)
	}
}

func i64str(n int64) string {
	return fmt.Sprintf("%d", n)
}

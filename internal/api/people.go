package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/georgebuilds/degu/internal/db"
)

// PeopleHandler handles /api/people and /api/people/{id}.
func PeopleHandler(d *sql.DB) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/people", func(w http.ResponseWriter, r *http.Request) {
		people, err := db.ListPeople(r.Context(), d)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if people == nil {
			people = []db.Person{}
		}
		writeJSON(w, people)
	})

	mux.HandleFunc("POST /api/people", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name string `json:"name"`
		}
		if err := decodeJSON(w, r, &body); err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		body.Name = strings.TrimSpace(body.Name)
		if body.Name == "" {
			writeJSONError(w, http.StatusBadRequest, "name is required")
			return
		}
		p, err := db.CreatePerson(r.Context(), d, body.Name)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE constraint") {
				writeJSONError(w, http.StatusConflict, "person already exists")
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusCreated)
		writeJSON(w, p)
	})

	mux.HandleFunc("PUT /api/people/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid id")
			return
		}
		var body struct {
			Name string `json:"name"`
		}
		if err := decodeJSON(w, r, &body); err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		body.Name = strings.TrimSpace(body.Name)
		if body.Name == "" {
			writeJSONError(w, http.StatusBadRequest, "name is required")
			return
		}
		p, err := db.RenamePerson(r.Context(), d, id, body.Name)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSONError(w, http.StatusNotFound, "person not found")
				return
			}
			if strings.Contains(err.Error(), "UNIQUE constraint") {
				writeJSONError(w, http.StatusConflict, "name already taken")
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, p)
	})

	mux.HandleFunc("DELETE /api/people/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid id")
			return
		}
		if err := db.DeletePerson(r.Context(), d, id); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSONError(w, http.StatusNotFound, "person not found")
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})

	return mux
}

// FacesHandler handles /api/faces, /api/faces/{id}, and /api/faces/by-person/{id}.
func FacesHandler(root string, d *sql.DB) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/faces", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Query().Get("path")
		if path == "" {
			writeJSONError(w, http.StatusBadRequest, "path query parameter required")
			return
		}
		if _, err := SafeJoin(root, path); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid path")
			return
		}
		regions, err := db.ListFaceRegions(r.Context(), d, path)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if regions == nil {
			regions = []db.FaceRegion{}
		}
		writeJSON(w, regions)
	})

	mux.HandleFunc("GET /api/faces/by-person/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid id")
			return
		}
		regions, err := db.ListFaceRegionsByPerson(r.Context(), d, id)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if regions == nil {
			regions = []db.FaceRegion{}
		}
		writeJSON(w, regions)
	})

	mux.HandleFunc("POST /api/faces", func(w http.ResponseWriter, r *http.Request) {
		var body db.FaceRegion
		if err := decodeJSON(w, r, &body); err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		body.RelPath = strings.TrimSpace(body.RelPath)
		if body.RelPath == "" {
			writeJSONError(w, http.StatusBadRequest, "relPath is required")
			return
		}
		if _, err := SafeJoin(root, body.RelPath); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid path")
			return
		}
		if body.Source == "" {
			body.Source = "manual"
		}
		region, err := db.CreateFaceRegion(r.Context(), d, body)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusCreated)
		writeJSON(w, region)
	})

	mux.HandleFunc("PUT /api/faces/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid id")
			return
		}
		var body db.FaceRegion
		if err := decodeJSON(w, r, &body); err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		body.ID = id
		if body.Source == "" {
			body.Source = "manual"
		}
		region, err := db.UpdateFaceRegion(r.Context(), d, body)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSONError(w, http.StatusNotFound, "face region not found")
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, region)
	})

	mux.HandleFunc("DELETE /api/faces/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid id")
			return
		}
		if err := db.DeleteFaceRegion(r.Context(), d, id); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeJSONError(w, http.StatusNotFound, "face region not found")
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})

	return mux
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	return dec.Decode(v)
}

// Package api implements the localhost JSON HTTP surface degu's SPA talks to.
package api

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/georgebuilds/degu/internal/db"
)

// TagsHandler returns a handler that GETs the current tag state and PUTs a
// full replacement. Both directions speak the same JSON shape that the SPA
// has always written to index.json, so the frontend's parsing/serialization
// logic doesn't need to change.
func TagsHandler(d *sql.DB) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/tags", func(w http.ResponseWriter, r *http.Request) {
		state, err := db.LoadTagState(r.Context(), d)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "load tag state: "+err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if err := json.NewEncoder(w).Encode(state); err != nil {
			return
		}
	})

	mux.HandleFunc("PUT /api/tags", func(w http.ResponseWriter, r *http.Request) {
		var state db.TagState
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<20))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&state); err != nil {
			writeJSONError(w, http.StatusBadRequest, "decode body: "+err.Error())
			return
		}
		if err := db.SaveTagState(r.Context(), d, &state); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "save tag state: "+err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	return mux
}

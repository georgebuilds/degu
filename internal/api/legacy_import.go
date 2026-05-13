package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/georgebuilds/degu/internal/db"
)

// LegacyIndexStatusHandler reports whether a one-shot legacy import is
// available for this folder. GET /api/legacy-index/status.
//
// Response body: db.LegacyIndexStatus. Errors propagate as 500.
func LegacyIndexStatusHandler(root string, d *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status, err := db.ProbeLegacyIndex(r.Context(), d, root)
		if err != nil {
			WriteJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(status)
	})
}

// legacyImportEvent is one event in the SSE stream emitted by the import
// handler. Exactly one of Progress or Result is populated.
type legacyImportEvent struct {
	Type     string                  `json:"type"`
	Progress *db.ImportProgress      `json:"progress,omitempty"`
	Result   *db.ImportLegacyResult  `json:"result,omitempty"`
	Error    string                  `json:"error,omitempty"`
}

// LegacyIndexImportHandler streams import progress as SSE then a final result
// event. POST /api/legacy-index/import.
//
// We use POST because this mutates state (imports rows, deletes the JSON
// file); SSE-via-fetch on the client side handles a POST-with-streamed-body
// just fine, EventSource is not required.
//
// Events:
//
//	{"type":"progress","progress":{"phase":"verifying","done":150,"total":200}}
//	{"type":"progress","progress":{"phase":"saving","done":1,"total":1}}
//	{"type":"result","result":{"imported":198,"missing":["…"],"skippedMalformed":0}}
//
// On unrecoverable error mid-stream, a final {"type":"error","error":"…"}
// event is sent before the connection closes.
func LegacyIndexImportHandler(root string, d *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			// All real net/http ResponseWriters implement Flusher; if we ever
			// land behind a middleware that doesn't, fail fast rather than
			// silently buffering the whole stream.
			WriteJSONError(w, http.StatusInternalServerError, "streaming unsupported")
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		send := func(ev legacyImportEvent) {
			payload, err := json.Marshal(ev)
			if err != nil {
				return
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		}

		res, err := db.ImportLegacyIndex(r.Context(), d, root, func(p db.ImportProgress) {
			cp := p
			send(legacyImportEvent{Type: "progress", Progress: &cp})
		})
		if err != nil {
			if errors.Is(err, r.Context().Err()) {
				return
			}
			send(legacyImportEvent{Type: "error", Error: err.Error()})
			return
		}
		send(legacyImportEvent{Type: "result", Result: &res})
	})
}

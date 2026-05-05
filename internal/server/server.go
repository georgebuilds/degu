package server

import (
	"database/sql"
	"io/fs"
	"net/http"
	"strings"

	"github.com/georgebuilds/degu/internal/api"
)

type Config struct {
	Root    string
	Version string
	DB      *sql.DB
}

type Server struct {
	cfg         Config
	static      http.Handler
	bundleReady bool
}

func New(cfg Config) *Server {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		// staticFS is embedded at compile time; this should be unreachable.
		panic("server: cannot open embedded static FS: " + err.Error())
	}
	_, indexErr := fs.Stat(sub, "index.html")
	return &Server{
		cfg:         cfg,
		static:      http.FileServerFS(sub),
		bundleReady: indexErr == nil,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	mux.HandleFunc("GET /api/info", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"` + jsonEscape(s.cfg.Version) + `","root":"` + jsonEscape(s.cfg.Root) + `"}`))
	})

	if s.cfg.DB != nil {
		mux.Handle("/api/tags", api.TagsHandler(s.cfg.DB))
		mux.Handle("/api/scan", api.ScanHandler(s.cfg.Root))
		mux.Handle("/api/stats", api.StatsHandler(s.cfg.Root, s.cfg.DB))
		mux.Handle("/api/file/", api.FileHandler(s.cfg.Root))
		mux.Handle("/api/thumb/", api.ThumbHandler(s.cfg.Root))
		mux.Handle("/api/save/", api.SaveHandler(s.cfg.Root))
		mux.Handle("/api/move", api.MoveHandler(s.cfg.Root, s.cfg.DB))
		mux.Handle("/api/move/", api.MoveHandler(s.cfg.Root, s.cfg.DB))
	}

	// Everything else: serve the embedded SPA bundle (or placeholder when
	// the frontend hasn't been built yet).
	if s.bundleReady {
		mux.Handle("/", s.static)
	} else {
		mux.HandleFunc("/", s.servePlaceholder)
	}

	return crossOriginIsolation(noCacheHTML(mux))
}

// crossOriginIsolation sets the COOP+COEP+CORP headers required by
// SharedArrayBuffer (and by `@ffmpeg/core-mt`).
func crossOriginIsolation(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Embedder-Policy", "require-corp")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

// noCacheHTML keeps the SPA shell fresh during local use; bundle assets
// are content-hashed by Vite so they can be cached by the browser as it sees fit.
func noCacheHTML(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) servePlaceholder(w http.ResponseWriter, _ *http.Request) {
	body, err := fs.ReadFile(staticFS, "static/placeholder.html")
	if err != nil {
		http.Error(w, "frontend not built", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = w.Write(body)
}

func jsonEscape(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch r {
		case '\\', '"':
			b.WriteByte('\\')
			b.WriteRune(r)
		case '\n':
			b.WriteString("\\n")
		case '\r':
			b.WriteString("\\r")
		case '\t':
			b.WriteString("\\t")
		default:
			if r < 0x20 {
				continue
			}
			b.WriteRune(r)
		}
	}
	return b.String()
}

package server

import (
	"database/sql"
	"io/fs"
	"net/http"
	"strconv"
	"strings"

	"github.com/georgebuilds/degu/internal/api"
)

type Config struct {
	Root    string
	Version string
	DB      *sql.DB
	// Port is the loopback port the CLI is listening on. Used to validate
	// Origin/Host headers against http://localhost:<port> and
	// http://127.0.0.1:<port>. Ignored when EnableOriginGuard is false.
	Port int
	// EnableOriginGuard turns on the Origin/Host CSRF + DNS-rebinding guard
	// for /api/* routes. The Wails desktop binary leaves this false because
	// it serves through an in-process AssetServer that never sees the network.
	EnableOriginGuard bool
}

type Server struct {
	cfg         Config
	static      http.Handler
	bundleReady bool
}

func New(cfg Config) *Server {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
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

	apiMux := http.NewServeMux()

	apiMux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	apiMux.HandleFunc("GET /api/info", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"` + jsonEscape(s.cfg.Version) + `","root":"` + jsonEscape(s.cfg.Root) + `"}`))
	})

	if s.cfg.DB != nil {
		apiMux.Handle("/api/tags", methodGate(api.TagsHandler(s.cfg.DB), http.MethodGet, http.MethodPut))
		apiMux.Handle("/api/scan", methodGate(api.ScanHandler(s.cfg.Root), http.MethodGet))
		apiMux.Handle("/api/stats", methodGate(api.StatsHandler(s.cfg.Root, s.cfg.DB), http.MethodGet))
		apiMux.Handle("/api/file/", methodGate(api.FileHandler(s.cfg.Root, s.cfg.DB), http.MethodGet, http.MethodHead, http.MethodDelete))
		apiMux.Handle("/api/thumb/", methodGate(api.ThumbHandler(s.cfg.Root), http.MethodGet, http.MethodHead))
		apiMux.Handle("/api/save/", methodGate(api.SaveHandler(s.cfg.Root), http.MethodPut, http.MethodPost))
		apiMux.Handle("/api/move", methodGate(api.MoveHandler(s.cfg.Root, s.cfg.DB), http.MethodPost))
		apiMux.Handle("/api/move/", methodGate(api.MoveHandler(s.cfg.Root, s.cfg.DB), http.MethodPost))
	}

	mux.Handle("/api/", s.originGuard(apiMux))

	if s.bundleReady {
		mux.Handle("/", s.static)
	} else {
		mux.HandleFunc("/", s.servePlaceholder)
	}

	return crossOriginIsolation(noCacheHTML(mux))
}

// originGuard rejects /api/* requests whose Origin or Host headers don't match
// the loopback bindings, defending against malicious cross-origin browser tabs
// (CSRF) and DNS-rebinding attacks. Wails desktop wires EnableOriginGuard=false
// because its in-process AssetServer never sees the network.
func (s *Server) originGuard(next http.Handler) http.Handler {
	if !s.cfg.EnableOriginGuard {
		return next
	}
	port := strconv.Itoa(s.cfg.Port)
	allowedHosts := map[string]struct{}{
		"localhost:" + port: {},
		"127.0.0.1:" + port: {},
	}
	allowedOrigins := map[string]struct{}{
		"http://localhost:" + port: {},
		"http://127.0.0.1:" + port: {},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := allowedHosts[r.Host]; !ok {
			api.WriteJSONError(w, http.StatusForbidden, "forbidden host")
			return
		}
		if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" {
			api.WriteJSONError(w, http.StatusForbidden, "forbidden cross-site request")
			return
		}
		if isUnsafeMethod(r.Method) {
			origin := r.Header.Get("Origin")
			if origin == "" {
				api.WriteJSONError(w, http.StatusForbidden, "missing Origin")
				return
			}
			if _, ok := allowedOrigins[origin]; !ok {
				api.WriteJSONError(w, http.StatusForbidden, "forbidden origin")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func isUnsafeMethod(m string) bool {
	switch m {
	case http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch:
		return true
	}
	return false
}

func methodGate(h http.Handler, allowed ...string) http.Handler {
	allow := strings.Join(allowed, ", ")
	set := make(map[string]struct{}, len(allowed))
	for _, m := range allowed {
		set[m] = struct{}{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := set[r.Method]; !ok {
			w.Header().Set("Allow", allow)
			api.WriteJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		h.ServeHTTP(w, r)
	})
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
		p := r.URL.Path
		if p == "/" || strings.HasSuffix(p, ".html") || strings.HasSuffix(p, ".htm") {
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

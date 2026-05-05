package server

import "embed"

// staticFS holds the Vite-built single-file bundle.
//
// The build pipeline copies dist/index.html → internal/server/static/index.html
// before running `go build`. A placeholder is committed so `go build` works
// even when the frontend hasn't been built yet — the server detects it and
// serves a "frontend not built" page instead.
//
//go:embed all:static
var staticFS embed.FS

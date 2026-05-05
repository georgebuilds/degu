// Wails entry point for the macOS arm64 desktop app.
//
// The CLI binary at cmd/degu/ is the headless flavour (used for releases that
// want to embed degu in a server, or for `degu serve` use-cases). This main.go
// wraps the same internal/server handler in a Wails-managed WKWebView so a
// double-click on degu.app gives a real desktop app: native menu, dock icon,
// single-instance lock, no browser tab.
//
// Wails' AssetServer takes any http.Handler — we hand it the very same handler
// the headless server exposes, which means everything (COOP/COEP for
// ffmpeg.wasm, /api/*, the embedded SPA bundle) keeps working unchanged.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"github.com/georgebuilds/degu/internal/db"
	"github.com/georgebuilds/degu/internal/server"
)

// version is overridden at link time via -ldflags "-X main.version=…".
var version = "dev"

func main() {
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: degu [path]\n\n")
		fmt.Fprintf(os.Stderr, "  With no path, degu serves the folder it lives in when that\n")
		fmt.Fprintf(os.Stderr, "  folder is somewhere personal under your home dir. Otherwise\n")
		fmt.Fprintf(os.Stderr, "  it falls back to ~/Pictures (or ~/ if Pictures is missing).\n\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	root, err := resolveRoot(flag.Arg(0))
	if err != nil {
		log.Fatalf("degu: %v", err)
	}

	ctx := context.Background()
	store, err := db.Open(ctx, root)
	if err != nil {
		log.Fatalf("degu: %v", err)
	}
	defer store.Close()

	if imported, err := db.MaybeImportLegacyIndex(ctx, store, root); err != nil {
		log.Fatalf("degu: legacy import: %v", err)
	} else if imported {
		log.Printf("degu: imported legacy index.json")
	}

	srv := server.New(server.Config{
		Root:    root,
		Version: version,
		DB:      store,
	})

	err = wails.Run(&options.App{
		Title:     "degu",
		Width:     1280,
		Height:    820,
		MinWidth:  720,
		MinHeight: 480,
		AssetServer: &assetserver.Options{
			Handler: srv.Handler(),
		},
		// landing-page --sky-0; same colour the SPA's body gradient bottoms
		// out to in its top corners, so the moment between window-open and
		// SPA-paint is a seamless step into the night sky.
		BackgroundColour: &options.RGBA{R: 5, G: 7, B: 21, A: 255},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
			About: &mac.AboutInfo{
				Title:   "degu",
				Message: "local-first media browser",
			},
			Appearance:           mac.NSAppearanceNameDarkAqua,
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "com.georgebuilds.degu",
			OnSecondInstanceLaunch: func(_ options.SecondInstanceData) {
				// Wails brings the existing window forward automatically when
				// this callback is set; an explicit show is not required.
			},
		},
	})
	if err != nil {
		log.Fatalf("degu: wails: %v", err)
	}
}

// resolveRoot picks the media root to scope the server and degu.db to.
//
// CLI arg wins when present (so `open -a degu --args /path` and `degu /path`
// both work). Otherwise we prefer the folder the bundle lives in, when it's
// somewhere personal — i.e. the user dropped degu.app or the binary into a
// media folder under their home dir. /Applications, ~/Applications, and "bin"
// dirs are excluded so a system or brew install still falls through to the
// conventional ~/Pictures default. Last resort: ~/, or os.Getwd if home
// lookup itself fails.
func resolveRoot(arg string) (string, error) {
	if arg != "" {
		abs, err := filepath.Abs(arg)
		if err != nil {
			return "", fmt.Errorf("resolve %q: %w", arg, err)
		}
		info, err := os.Stat(abs)
		if err != nil {
			return "", fmt.Errorf("stat %q: %w", abs, err)
		}
		if !info.IsDir() {
			return "", fmt.Errorf("%q is not a directory", abs)
		}
		return abs, nil
	}

	home, _ := os.UserHomeDir()

	if dir := bundleHomeDir(); dir != "" && isPersonalDir(dir, home) {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir, nil
		}
	}

	if home == "" {
		return os.Getwd()
	}
	pics := filepath.Join(home, "Pictures")
	if info, err := os.Stat(pics); err == nil && info.IsDir() {
		return pics, nil
	}
	return home, nil
}

// bundleHomeDir returns the directory the running degu binary appears to live
// in. On macOS that's the directory containing degu.app (we walk up out of
// degu.app/Contents/MacOS/). On Linux/Windows it's just the directory of the
// executable. Returns "" if os.Executable fails.
func bundleHomeDir() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return bundleHomeDirFor(exe)
}

// bundleHomeDirFor is the path-only half of bundleHomeDir, split so tests can
// drive it without pinning to the real os.Executable.
func bundleHomeDirFor(exe string) string {
	dir := filepath.Dir(exe)
	if filepath.Base(dir) == "MacOS" {
		contents := filepath.Dir(dir)
		if filepath.Base(contents) == "Contents" {
			bundle := filepath.Dir(contents)
			if strings.HasSuffix(bundle, ".app") {
				return filepath.Dir(bundle)
			}
		}
	}
	return dir
}

// isPersonalDir reports whether p sits somewhere personal under home — a
// reasonable default for "the user dropped degu next to their media". Returns
// false for paths outside home, for home itself, and for Applications- or
// bin-style directories that suggest a system install.
func isPersonalDir(p, home string) bool {
	if home == "" {
		return false
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return false
	}
	homeAbs, err := filepath.Abs(home)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(homeAbs, abs)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return false
	}
	switch filepath.Base(abs) {
	case "Applications", "bin", "sbin":
		return false
	}
	return true
}

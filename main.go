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
		fmt.Fprintf(os.Stderr, "  With no path, degu serves the folder the binary lives in.\n")
		fmt.Fprintf(os.Stderr, "  Pass a path to override.\n\n")
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
			TitleBar: mac.TitleBarDefault(),
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

// resolveRoot picks the media root: the folder the binary lives in.
//
// CLI arg always wins (so `degu /path` or `open -a degu --args /path` can
// override). With no arg, we use bundleHomeDir() — the directory the running
// degu executable sits in. There is NO automatic fallback to ~/Pictures or
// anywhere else: degu's whole proposition is "drop me into a folder and I
// serve that folder", which means putting the binary in /Applications,
// /usr/local/bin, or some other system location is a usage error rather
// than a hint to silently pivot to ~/Pictures. If os.Executable fails
// entirely we surface that — the user can recover with an explicit path.
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

	dir := bundleHomeDir()
	if dir == "" {
		return "", fmt.Errorf("could not determine the folder this binary lives in; pass an explicit path: degu <folder>")
	}
	info, err := os.Stat(dir)
	if err != nil {
		return "", fmt.Errorf("stat binary's folder %q: %w", dir, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("binary's folder %q is not a directory", dir)
	}
	return dir, nil
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
//
// When the exe lives inside what *looks* like a macOS bundle (a parent named
// `MacOS`) but the rest of the bundle structure is missing, we deliberately
// return "" rather than the bare `…/MacOS` directory — handing back a path
// the caller may treat as a personal media root would surprise the user.
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
		return ""
	}
	return dir
}

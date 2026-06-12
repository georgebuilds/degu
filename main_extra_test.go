package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestResolveRootArgIsRelativeMadeAbsolute confirms a relative directory arg is
// resolved to an absolute path (resolveRoot runs filepath.Abs before stat).
func TestResolveRootArgIsRelativeMadeAbsolute(t *testing.T) {
	dir := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() { os.Chdir(wd) })
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	got, err := resolveRoot(".")
	if err != nil {
		t.Fatalf("resolveRoot(\".\"): %v", err)
	}
	if !filepath.IsAbs(got) {
		t.Errorf("resolveRoot(\".\") = %q, want an absolute path", got)
	}
	// On macOS TempDir may be under /private symlink — compare resolved forms.
	wantResolved, _ := filepath.EvalSymlinks(dir)
	gotResolved, _ := filepath.EvalSymlinks(got)
	if gotResolved != wantResolved {
		t.Errorf("resolveRoot(\".\") = %q (resolved %q), want %q", got, gotResolved, wantResolved)
	}
}

// TestBundleHomeDirReal exercises bundleHomeDir() (the os.Executable-backed
// wrapper) end to end: under `go test` the executable is the real test binary,
// so it must return a non-empty existing directory.
func TestBundleHomeDirReal(t *testing.T) {
	got := bundleHomeDir()
	if got == "" {
		t.Fatalf("bundleHomeDir() = \"\", want the test binary's dir")
	}
	info, err := os.Stat(got)
	if err != nil || !info.IsDir() {
		t.Fatalf("bundleHomeDir() = %q which is not a directory: %v", got, err)
	}
}

// TestBundleHomeDirForWindowsStylePlain confirms a Windows-style plain binary
// path (no MacOS/Contents bundle markers) yields its containing directory.
func TestBundleHomeDirForWindowsStylePlain(t *testing.T) {
	exe := filepath.FromSlash("/Apps/degu/degu.exe")
	got := bundleHomeDirFor(exe)
	want := filepath.FromSlash("/Apps/degu")
	if got != want {
		t.Errorf("bundleHomeDirFor(%q) = %q, want %q", exe, got, want)
	}
}

// TestBundleHomeDirForNestedAppBundle confirms a fully-formed .app bundle nested
// arbitrarily deep resolves to the directory that contains the .app.
func TestBundleHomeDirForNestedAppBundle(t *testing.T) {
	exe := filepath.FromSlash("/Volumes/Media/Trips/2024/degu.app/Contents/MacOS/degu")
	got := bundleHomeDirFor(exe)
	want := filepath.FromSlash("/Volumes/Media/Trips/2024")
	if got != want {
		t.Errorf("bundleHomeDirFor(%q) = %q, want %q", exe, got, want)
	}
}

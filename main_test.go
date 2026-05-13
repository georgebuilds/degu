package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveRootExplicitArg(t *testing.T) {
	dir := t.TempDir()
	got, err := resolveRoot(dir)
	if err != nil {
		t.Fatalf("resolveRoot(%q): %v", dir, err)
	}
	if got != dir {
		t.Errorf("resolveRoot(%q) = %q, want %q", dir, got, dir)
	}
}

func TestResolveRootExplicitArgRejectsFiles(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "not-a-dir-*")
	if err != nil {
		t.Fatalf("create temp file: %v", err)
	}
	f.Close()
	if _, err := resolveRoot(f.Name()); err == nil {
		t.Errorf("expected error when arg is a regular file, got nil")
	}
}

func TestResolveRootExplicitArgRejectsMissing(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does-not-exist")
	if _, err := resolveRoot(missing); err == nil {
		t.Errorf("expected error when arg path is missing, got nil")
	}
}

// resolveRoot without an arg defers to bundleHomeDir(), which reads
// os.Executable() — under `go test` that's the compiled test binary in a
// temp dir, which both exists and is a directory. So calling resolveRoot("")
// must succeed and must NOT fall back to ~/Pictures anymore. We don't pin
// the exact path; we just assert "no error, and it's a real directory" to
// catch any future drift back toward a Pictures fallback.
func TestResolveRootNoArgUsesBundleHomeDir(t *testing.T) {
	got, err := resolveRoot("")
	if err != nil {
		t.Fatalf("resolveRoot(\"\"): %v", err)
	}
	info, err := os.Stat(got)
	if err != nil || !info.IsDir() {
		t.Fatalf("resolveRoot returned %q which is not a directory: %v", got, err)
	}
	if home, _ := os.UserHomeDir(); home != "" {
		pictures := filepath.Join(home, "Pictures")
		if got == pictures {
			t.Errorf("resolveRoot fell back to %q — strict mode should not", pictures)
		}
		if got == home {
			t.Errorf("resolveRoot fell back to home %q — strict mode should not", home)
		}
		if !strings.HasPrefix(got, os.TempDir()) && !strings.Contains(got, "go-build") {
			t.Logf("resolveRoot returned %q (likely the test binary's dir under TempDir)", got)
		}
	}
}

func TestBundleHomeDirMacAppBundle(t *testing.T) {
	exe := filepath.FromSlash("/Users/me/Photos/degu.app/Contents/MacOS/degu")
	got := bundleHomeDirFor(exe)
	want := filepath.FromSlash("/Users/me/Photos")
	if got != want {
		t.Errorf("bundleHomeDirFor(%q) = %q, want %q", exe, got, want)
	}
}

func TestBundleHomeDirPlainBinary(t *testing.T) {
	exe := filepath.FromSlash("/Users/me/Photos/degu")
	got := bundleHomeDirFor(exe)
	want := filepath.FromSlash("/Users/me/Photos")
	if got != want {
		t.Errorf("bundleHomeDirFor(%q) = %q, want %q", exe, got, want)
	}
}

// A binary that lives under a `MacOS` directory but isn't part of a real
// .app bundle should not be treated as a bundled install — returning the
// bare MacOS path would mislead resolveRoot into using it as a media root.
func TestBundleHomeDirPartialBundleReturnsEmpty(t *testing.T) {
	cases := []string{
		"/Users/me/Documents/MacOS/degu",
		"/Users/me/Documents/MacOS/Contents/MacOS/degu",
		"/Users/me/Documents/MacOS/Contents/degu/MacOS/degu",
	}
	for _, exe := range cases {
		got := bundleHomeDirFor(filepath.FromSlash(exe))
		if got != "" {
			t.Errorf("bundleHomeDirFor(%q) = %q, want \"\"", exe, got)
		}
	}
}

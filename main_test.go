package main

import (
	"path/filepath"
	"testing"
)

func TestIsPersonalDir(t *testing.T) {
	home := "/Users/me"
	cases := []struct {
		path string
		want bool
	}{
		{"/Users/me/Photos", true},
		{"/Users/me/Photos/2024", true},
		{"/Users/me/Code/degu", true},
		{"/Users/me", false},
		{"/Users/me/Applications", false},
		{"/Users/me/bin", false},
		{"/Users/other/Photos", false},
		{"/Applications", false},
		{"/usr/local/bin", false},
		{"/var/folders/x/y", false},
	}
	for _, c := range cases {
		if got := isPersonalDir(c.path, home); got != c.want {
			t.Errorf("isPersonalDir(%q, %q) = %v, want %v", c.path, home, got, c.want)
		}
	}
	if isPersonalDir("/Users/me/Photos", "") {
		t.Errorf("isPersonalDir with empty home should return false")
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

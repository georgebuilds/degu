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

package main

import "testing"

// TestBuildVersionDefault confirms buildVersion reflects the package-level
// version var (its default "dev" unless overridden at link time).
func TestBuildVersionDefault(t *testing.T) {
	if got := buildVersion(); got != version {
		t.Errorf("buildVersion() = %q, want %q (the package version var)", got, version)
	}
}

// TestBuildVersionReflectsOverride confirms buildVersion tracks the version var
// when it's replaced (as the -ldflags "-X main.version=…" link step does).
func TestBuildVersionReflectsOverride(t *testing.T) {
	orig := version
	t.Cleanup(func() { version = orig })

	version = "1.2.3"
	if got := buildVersion(); got != "1.2.3" {
		t.Errorf("buildVersion() = %q, want %q after override", got, "1.2.3")
	}
}

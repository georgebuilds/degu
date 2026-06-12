package server

import (
	"os"
	"runtime"
	"testing"
)

// TestOpenBrowserLauncherMissing exercises the error path of OpenBrowser
// without launching a real browser: by emptying PATH the platform launcher
// (open / xdg-open / rundll32) can't be resolved, so cmd.Start() fails and
// OpenBrowser must surface that error.
func TestOpenBrowserLauncherMissing(t *testing.T) {
	orig, had := os.LookupEnv("PATH")
	t.Cleanup(func() {
		if had {
			os.Setenv("PATH", orig)
		} else {
			os.Unsetenv("PATH")
		}
	})
	if err := os.Setenv("PATH", ""); err != nil {
		t.Fatalf("clear PATH: %v", err)
	}

	if err := OpenBrowser("http://127.0.0.1:0/"); err == nil {
		t.Errorf("OpenBrowser with empty PATH: got nil error, want a launch failure")
	}
}

// TestOpenBrowserSuccess covers the happy path (cmd.Start succeeds, OpenBrowser
// returns nil and reaps the launcher in its goroutine). On darwin the `open`
// binary is guaranteed present, and a malformed pseudo-URL makes `open` exit
// non-zero *after* launch without actually opening any browser window — so
// Start() returns nil and we exercise the success branch with no UI side
// effects. On other platforms the launcher may be absent or may genuinely pop a
// window, so we gate behind an opt-in env var.
func TestOpenBrowserSuccess(t *testing.T) {
	if runtime.GOOS != "darwin" {
		if _, ok := os.LookupEnv("DEGU_TEST_OPEN_BROWSER"); !ok {
			t.Skip("set DEGU_TEST_OPEN_BROWSER=1 to exercise the real launcher (it may pop a window)")
		}
	}
	if err := OpenBrowser("degu-test-not-openable://###"); err != nil {
		t.Errorf("OpenBrowser: got %v, want nil", err)
	}
}

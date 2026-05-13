package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
	"time"
)

func decodeUpdateResp(t *testing.T, rec *httptest.ResponseRecorder) CheckUpdateResponse {
	t.Helper()
	var got CheckUpdateResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return got
}

func TestCheckUpdate_UpToDate(t *testing.T) {
	uc := CheckUpdateHandler("0.1.8").WithReleaseFetcher(func(context.Context) (githubRelease, error) {
		return githubRelease{
			TagName:     "v0.1.8",
			HTMLURL:     "https://example.test/releases/v0.1.8",
			PublishedAt: "2026-05-01T00:00:00Z",
		}, nil
	})
	rec := httptest.NewRecorder()
	uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	got := decodeUpdateResp(t, rec)
	if got.UpdateAvailable {
		t.Fatalf("expected no update; got %+v", got)
	}
	if got.Current != "0.1.8" || got.Latest != "0.1.8" {
		t.Fatalf("version mismatch: %+v", got)
	}
}

func TestCheckUpdate_NewerAvailable(t *testing.T) {
	asset := "degu-v0.1.9" + currentPlatformSuffix()
	uc := CheckUpdateHandler("0.1.8").WithReleaseFetcher(func(context.Context) (githubRelease, error) {
		return githubRelease{
			TagName: "v0.1.9",
			HTMLURL: "https://example.test/releases/v0.1.9",
			Assets: []githubReleaseAsset{
				{Name: asset, DownloadURL: "https://example.test/" + asset},
				{Name: asset + ".sha256", DownloadURL: "https://example.test/" + asset + ".sha256"},
			},
		}, nil
	})
	rec := httptest.NewRecorder()
	uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	got := decodeUpdateResp(t, rec)
	if !got.UpdateAvailable {
		t.Fatalf("expected update available; got %+v", got)
	}
	if got.Latest != "0.1.9" {
		t.Fatalf("latest mismatch: %+v", got)
	}
	// Asset URL should resolve when the runner OS/arch has a known bundle
	// pattern; runners off the supported triples (e.g. darwin-amd64) leave
	// AssetURL empty by design, so only assert when the pattern is known.
	if assetPatternForCurrentPlatform() != "" && got.AssetURL == "" {
		t.Fatalf("expected AssetURL; got empty")
	}
	if got.AssetURL != "" && got.AssetURL[len(got.AssetURL)-7:] == ".sha256" {
		t.Fatalf("AssetURL picked the .sha256 sidecar: %s", got.AssetURL)
	}
}

func TestCheckUpdate_FetchError(t *testing.T) {
	uc := CheckUpdateHandler("0.1.8").WithReleaseFetcher(func(context.Context) (githubRelease, error) {
		return githubRelease{}, errors.New("github unreachable")
	})
	rec := httptest.NewRecorder()
	uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	got := decodeUpdateResp(t, rec)
	if got.UpdateAvailable {
		t.Fatalf("expected no update on error; got %+v", got)
	}
	if got.Error == "" {
		t.Fatalf("expected error message; got %+v", got)
	}
}

func TestCheckUpdate_CachesAcrossCalls(t *testing.T) {
	var calls int
	uc := CheckUpdateHandler("0.1.8").WithReleaseFetcher(func(context.Context) (githubRelease, error) {
		calls++
		return githubRelease{TagName: "v0.1.8"}, nil
	})
	for i := 0; i < 3; i++ {
		rec := httptest.NewRecorder()
		uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	}
	if calls != 1 {
		t.Fatalf("expected fetcher called once, got %d", calls)
	}

	// Advance fake clock past TTL and expect a refresh.
	uc.now = func() time.Time { return time.Now().Add(2 * updateCacheTTL) }
	rec := httptest.NewRecorder()
	uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	if calls != 2 {
		t.Fatalf("expected fetcher re-called after TTL, got %d", calls)
	}
}

func TestCompareSemver(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.1.8", "0.1.8", 0},
		{"0.1.9", "0.1.8", 1},
		{"0.1.8", "0.1.9", -1},
		{"1.0.0", "0.99.99", 1},
		{"0.2.0", "0.1.99", 1},
	}
	for _, tc := range cases {
		got, err := compareSemver(tc.a, tc.b)
		if err != nil {
			t.Fatalf("compareSemver(%q,%q) err: %v", tc.a, tc.b, err)
		}
		if got != tc.want {
			t.Fatalf("compareSemver(%q,%q) = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}

	if _, err := compareSemver("1.2", "1.2.0"); err == nil {
		t.Fatalf("expected error for non-triple version")
	}
}

// currentPlatformSuffix mirrors assetPatternForCurrentPlatform so a
// supported-triple runner gets a non-empty AssetURL during the test.
func currentPlatformSuffix() string {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "darwin/arm64":
		return "-darwin-arm64.zip"
	case "linux/amd64":
		return "-linux-amd64.tar.gz"
	case "windows/amd64":
		return "-windows-amd64.zip"
	}
	return "-unknown"
}

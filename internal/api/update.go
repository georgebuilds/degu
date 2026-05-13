package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// CheckUpdateResponse is the JSON shape returned by GET /api/check-update.
type CheckUpdateResponse struct {
	Current         string `json:"current"`
	Latest          string `json:"latest,omitempty"`
	UpdateAvailable bool   `json:"updateAvailable"`
	ReleaseURL      string `json:"releaseUrl,omitempty"`
	AssetURL        string `json:"assetUrl,omitempty"`
	PublishedAt     string `json:"publishedAt,omitempty"`
	// Error is set when the lookup itself failed (network, rate-limit,
	// malformed response). UpdateAvailable is false in that case; the UI
	// surfaces Error as a friendly "couldn't check" message.
	Error string `json:"error,omitempty"`
}

const (
	updateRepoOwner = "georgebuilds"
	updateRepoName  = "degu"
	// Unauthenticated GitHub API allows 60 req/IP/hour. Cache successful
	// lookups for 5 minutes so a user mashing the button doesn't burn quota.
	updateCacheTTL = 5 * time.Minute
)

// CheckUpdateHandler returns a handler that queries GitHub for the latest
// release and reports whether the running binary is up to date.
//
// The fetcher is mockable for tests via WithReleaseFetcher.
func CheckUpdateHandler(currentVersion string) *UpdateChecker {
	return &UpdateChecker{
		current: currentVersion,
		client:  &http.Client{Timeout: 8 * time.Second},
		now:     time.Now,
	}
}

// UpdateChecker is exposed so tests can swap the fetcher.
type UpdateChecker struct {
	current string
	client  *http.Client
	// fetcher is the strategy used to load the latest release. Tests replace
	// it; production leaves it nil and the default GitHub fetcher is used.
	fetcher func(ctx context.Context) (githubRelease, error)
	// now is injectable so cache-TTL tests are deterministic.
	now func() time.Time

	mu       sync.Mutex
	cached   *CheckUpdateResponse
	cachedAt time.Time
}

// WithReleaseFetcher overrides the GitHub-API fetcher. Returning an error
// from the fetcher surfaces as resp.Error to the client (no HTTP failure).
func (u *UpdateChecker) WithReleaseFetcher(f func(ctx context.Context) (githubRelease, error)) *UpdateChecker {
	u.fetcher = f
	return u
}

func (u *UpdateChecker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	resp := u.evaluate(r.Context())
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

type githubReleaseAsset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"browser_download_url"`
}

type githubRelease struct {
	TagName     string               `json:"tag_name"`
	HTMLURL     string               `json:"html_url"`
	PublishedAt string               `json:"published_at"`
	Prerelease  bool                 `json:"prerelease"`
	Draft       bool                 `json:"draft"`
	Assets      []githubReleaseAsset `json:"assets"`
}

func (u *UpdateChecker) evaluate(ctx context.Context) CheckUpdateResponse {
	u.mu.Lock()
	if u.cached != nil && u.now().Sub(u.cachedAt) < updateCacheTTL {
		cached := *u.cached
		u.mu.Unlock()
		return cached
	}
	u.mu.Unlock()

	resp := CheckUpdateResponse{Current: u.current}

	fetch := u.fetcher
	if fetch == nil {
		fetch = u.fetchGitHub
	}
	release, err := fetch(ctx)
	if err != nil {
		resp.Error = err.Error()
		return resp
	}

	latest := strings.TrimPrefix(release.TagName, "v")
	resp.Latest = latest
	resp.ReleaseURL = release.HTMLURL
	resp.PublishedAt = release.PublishedAt

	cmp, cmpErr := compareSemver(latest, strings.TrimPrefix(u.current, "v"))
	if cmpErr == nil && cmp > 0 {
		resp.UpdateAvailable = true
	}

	if pattern := assetPatternForCurrentPlatform(); pattern != "" {
		for _, a := range release.Assets {
			// Match the bundle, never its sibling .sha256 — the substring
			// match would otherwise pick up both and the order is unstable.
			if strings.Contains(a.Name, pattern) && !strings.HasSuffix(a.Name, ".sha256") {
				resp.AssetURL = a.DownloadURL
				break
			}
		}
	}

	u.mu.Lock()
	u.cached = &resp
	u.cachedAt = u.now()
	u.mu.Unlock()
	return resp
}

func (u *UpdateChecker) fetchGitHub(ctx context.Context) (githubRelease, error) {
	var zero githubRelease
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", updateRepoOwner, updateRepoName)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return zero, errors.New("failed to build request")
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "degu-check-update")

	httpResp, err := u.client.Do(req)
	if err != nil {
		return zero, errors.New("github unreachable")
	}
	defer httpResp.Body.Close()
	if httpResp.StatusCode != http.StatusOK {
		return zero, fmt.Errorf("github returned %d", httpResp.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(httpResp.Body).Decode(&release); err != nil {
		return zero, errors.New("github response malformed")
	}
	return release, nil
}

// assetPatternForCurrentPlatform returns a substring that uniquely identifies
// the GUI bundle asset for the running OS/arch. Empty means "no asset for
// this platform" — the UI falls back to the release URL.
func assetPatternForCurrentPlatform() string {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "darwin/arm64":
		return "-darwin-arm64.zip"
	case "linux/amd64":
		return "-linux-amd64.tar.gz"
	case "windows/amd64":
		return "-windows-amd64.zip"
	}
	return ""
}

// compareSemver does a naive triple compare of two `<major>.<minor>.<patch>`
// strings. Returns +1 if a > b, -1 if a < b, 0 if equal. The release.yml
// tag validator only accepts `^v[0-9]+\.[0-9]+\.[0-9]+$`, so a 3-segment
// parser is sufficient and avoids pulling in golang.org/x/mod/semver as a
// direct dependency.
func compareSemver(a, b string) (int, error) {
	ap, err := parseTriple(a)
	if err != nil {
		return 0, err
	}
	bp, err := parseTriple(b)
	if err != nil {
		return 0, err
	}
	for i := 0; i < 3; i++ {
		if ap[i] != bp[i] {
			if ap[i] > bp[i] {
				return 1, nil
			}
			return -1, nil
		}
	}
	return 0, nil
}

func parseTriple(s string) ([3]int, error) {
	var out [3]int
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return out, errors.New("not a 3-segment version")
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return out, err
		}
		out[i] = n
	}
	return out, nil
}

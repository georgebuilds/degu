package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ApplyUpdateResponse is the JSON shape returned by POST /api/apply-update.
type ApplyUpdateResponse struct {
	Success    bool   `json:"success"`
	NewVersion string `json:"newVersion,omitempty"`
	Error      string `json:"error,omitempty"`
}

// ApplyHandler returns an http.Handler for POST /api/apply-update. It
// downloads the latest CLI binary from GitHub Releases, verifies its SHA256
// hash against the published sidecar, and atomically replaces the running
// executable. The caller must restart the process to run the new version.
func (u *UpdateChecker) ApplyHandler() http.Handler {
	var applyMu sync.Mutex
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !u.selfUpdate {
			writeApplyResp(w, http.StatusBadRequest, ApplyUpdateResponse{
				Error: "self-update is not available in this mode",
			})
			return
		}

		if !applyMu.TryLock() {
			writeApplyResp(w, http.StatusConflict, ApplyUpdateResponse{
				Error: "an update is already in progress",
			})
			return
		}
		defer applyMu.Unlock()

		newVersion, err := u.applyUpdate(r.Context())
		if err != nil {
			writeApplyResp(w, http.StatusInternalServerError, ApplyUpdateResponse{
				Error: err.Error(),
			})
			return
		}

		writeApplyResp(w, http.StatusOK, ApplyUpdateResponse{
			Success:    true,
			NewVersion: newVersion,
		})
	})
}

func writeApplyResp(w http.ResponseWriter, status int, resp ApplyUpdateResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(resp)
}

func (u *UpdateChecker) applyUpdate(ctx context.Context) (string, error) {
	fetch := u.fetcher
	if fetch == nil {
		fetch = u.fetchGitHub
	}
	release, err := fetch(ctx)
	if err != nil {
		return "", fmt.Errorf("check release: %w", err)
	}

	latest := strings.TrimPrefix(release.TagName, "v")
	current := strings.TrimPrefix(u.current, "v")
	cmp, err := compareSemver(latest, current)
	if err != nil {
		return "", fmt.Errorf("compare versions: %w", err)
	}
	if cmp <= 0 {
		return "", fmt.Errorf("already up to date (%s)", current)
	}

	bin, hashAsset, ok := findCLIAssets(release.Assets)
	if !ok {
		return "", fmt.Errorf("no CLI binary for %s/%s", runtime.GOOS, runtime.GOARCH)
	}

	resolve := u.exeResolver
	if resolve == nil {
		resolve = resolveExe
	}
	exePath, err := resolve()
	if err != nil {
		return "", fmt.Errorf("locate binary: %w", err)
	}

	dlc := u.getDownloadClient()

	expectedHash, err := downloadHash(ctx, dlc, hashAsset.DownloadURL)
	if err != nil {
		return "", err
	}

	dir := filepath.Dir(exePath)
	tmp, err := downloadToFile(ctx, dlc, bin.DownloadURL, dir)
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp)

	actualHash, err := fileSHA256(tmp)
	if err != nil {
		return "", fmt.Errorf("hash downloaded binary: %w", err)
	}
	if actualHash != expectedHash {
		return "", fmt.Errorf("sha256 mismatch: expected %s, got %s", expectedHash, actualHash)
	}

	if runtime.GOOS != "windows" {
		if err := os.Chmod(tmp, 0755); err != nil {
			return "", fmt.Errorf("set permissions: %w", err)
		}
	}

	if err := replaceBinary(exePath, tmp); err != nil {
		return "", err
	}

	u.mu.Lock()
	u.pendingVersion = latest
	u.cached = nil
	u.mu.Unlock()

	return latest, nil
}

func (u *UpdateChecker) getDownloadClient() *http.Client {
	if u.downloadClient != nil {
		return u.downloadClient
	}
	return &http.Client{Timeout: 3 * time.Minute}
}

// cliAssetSuffix returns the suffix that uniquely identifies the CLI binary
// release asset for the running OS/arch. Empty means unsupported platform.
func cliAssetSuffix() string {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "darwin/arm64":
		return "-darwin-arm64"
	case "linux/amd64":
		return "-linux-amd64"
	case "windows/amd64":
		return "-windows-amd64.exe"
	}
	return ""
}

// findCLIAssets locates the CLI binary and its SHA256 sidecar in a release's
// asset list. Returns ok=false if either is missing or the platform is unknown.
func findCLIAssets(assets []githubReleaseAsset) (binary, hash githubReleaseAsset, ok bool) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		return
	}
	for _, a := range assets {
		if !strings.Contains(a.Name, "-cli-") {
			continue
		}
		if strings.HasSuffix(a.Name, suffix+".sha256") {
			hash = a
		} else if strings.HasSuffix(a.Name, suffix) {
			binary = a
		}
	}
	ok = binary.DownloadURL != "" && hash.DownloadURL != ""
	return
}

func resolveExe() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(exe)
}

func downloadHash(ctx context.Context, client *http.Client, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("build hash request: %w", err)
	}
	req.Header.Set("User-Agent", "degu-self-update")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download hash: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download hash: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024))
	if err != nil {
		return "", fmt.Errorf("read hash: %w", err)
	}
	fields := strings.Fields(strings.TrimSpace(string(body)))
	if len(fields) == 0 {
		return "", fmt.Errorf("empty hash file")
	}
	h := strings.ToLower(fields[0])
	if len(h) != 64 {
		return "", fmt.Errorf("invalid sha256 length: %d", len(h))
	}
	return h, nil
}

func downloadToFile(ctx context.Context, client *http.Client, url, dir string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("build download request: %w", err)
	}
	req.Header.Set("User-Agent", "degu-self-update")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download binary: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download binary: HTTP %d", resp.StatusCode)
	}

	tmp, err := os.CreateTemp(dir, ".degu-update-*")
	if err != nil {
		return "", fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmp.Name()

	const maxBytes = 200 << 20
	if _, err = io.Copy(tmp, io.LimitReader(resp.Body, maxBytes)); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return "", fmt.Errorf("write binary: %w", err)
	}
	if err = tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("close temp file: %w", err)
	}
	return tmpPath, nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// replaceBinary atomically replaces the binary at target with source. On Unix,
// this is a single rename. On Windows, the running exe is locked so we rename
// it out of the way first.
func replaceBinary(target, source string) error {
	if runtime.GOOS == "windows" {
		old := target + ".old"
		_ = os.Remove(old)
		if err := os.Rename(target, old); err != nil {
			return fmt.Errorf("move old binary: %w", err)
		}
		if err := os.Rename(source, target); err != nil {
			_ = os.Rename(old, target)
			return fmt.Errorf("move new binary: %w", err)
		}
		return nil
	}
	return os.Rename(source, target)
}

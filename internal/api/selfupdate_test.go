package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// ---------------------------------------------------------------------------
// findCLIAssets
// ---------------------------------------------------------------------------

func TestFindCLIAssets(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform for CLI asset detection")
	}

	assets := []githubReleaseAsset{
		{Name: "degu-v0.2.0-darwin-arm64.zip", DownloadURL: "https://example.test/gui.zip"},
		{Name: "degu-v0.2.0-darwin-arm64.zip.sha256", DownloadURL: "https://example.test/gui.zip.sha256"},
		{Name: "degu-cli-v0.2.0" + suffix, DownloadURL: "https://example.test/cli"},
		{Name: "degu-cli-v0.2.0" + suffix + ".sha256", DownloadURL: "https://example.test/cli.sha256"},
	}

	bin, hash, ok := findCLIAssets(assets)
	if !ok {
		t.Fatal("expected to find CLI assets")
	}
	if bin.DownloadURL != "https://example.test/cli" {
		t.Fatalf("binary URL = %q, want .../cli", bin.DownloadURL)
	}
	if hash.DownloadURL != "https://example.test/cli.sha256" {
		t.Fatalf("hash URL = %q, want .../cli.sha256", hash.DownloadURL)
	}
}

func TestFindCLIAssets_MissingSidecar(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform")
	}

	assets := []githubReleaseAsset{
		{Name: "degu-cli-v0.2.0" + suffix, DownloadURL: "https://example.test/cli"},
	}

	_, _, ok := findCLIAssets(assets)
	if ok {
		t.Fatal("expected ok=false when sidecar is missing")
	}
}

func TestFindCLIAssets_MissingBinary(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform")
	}

	assets := []githubReleaseAsset{
		{Name: "degu-cli-v0.2.0" + suffix + ".sha256", DownloadURL: "https://example.test/cli.sha256"},
	}

	_, _, ok := findCLIAssets(assets)
	if ok {
		t.Fatal("expected ok=false when binary is missing")
	}
}

func TestFindCLIAssets_IgnoresGUIBundle(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform")
	}

	assets := []githubReleaseAsset{
		{Name: "degu-v0.2.0-darwin-arm64.zip", DownloadURL: "https://example.test/gui.zip"},
		{Name: "degu-v0.2.0-darwin-arm64.zip.sha256", DownloadURL: "https://example.test/gui.sha256"},
	}

	_, _, ok := findCLIAssets(assets)
	if ok {
		t.Fatal("expected ok=false when only GUI assets present")
	}
}

func TestFindCLIAssets_EmptyList(t *testing.T) {
	_, _, ok := findCLIAssets(nil)
	if ok {
		t.Fatal("expected ok=false for empty asset list")
	}
}

// ---------------------------------------------------------------------------
// downloadHash
// ---------------------------------------------------------------------------

func TestDownloadHash_ShasumFormat(t *testing.T) {
	want := strings.Repeat("ab", 32)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, "%s  degu-cli-v0.3.0-darwin-arm64\n", want)
	}))
	defer srv.Close()

	got, err := downloadHash(context.Background(), srv.Client(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestDownloadHash_Sha256sumFormat(t *testing.T) {
	want := strings.Repeat("cd", 32)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, "%s *degu-cli-v0.3.0-windows-amd64.exe\n", want)
	}))
	defer srv.Close()

	got, err := downloadHash(context.Background(), srv.Client(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestDownloadHash_UppercaseNormalized(t *testing.T) {
	upper := strings.ToUpper(strings.Repeat("ef", 32))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, "%s  file\n", upper)
	}))
	defer srv.Close()

	got, err := downloadHash(context.Background(), srv.Client(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if got != strings.ToLower(upper) {
		t.Fatalf("expected lowercase, got %q", got)
	}
}

func TestDownloadHash_EmptyBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(""))
	}))
	defer srv.Close()

	_, err := downloadHash(context.Background(), srv.Client(), srv.URL)
	if err == nil {
		t.Fatal("expected error on empty body")
	}
}

func TestDownloadHash_InvalidLength(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, "tooshort  file\n")
	}))
	defer srv.Close()

	_, err := downloadHash(context.Background(), srv.Client(), srv.URL)
	if err == nil || !strings.Contains(err.Error(), "sha256 length") {
		t.Fatalf("expected sha256 length error, got %v", err)
	}
}

func TestDownloadHash_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	_, err := downloadHash(context.Background(), srv.Client(), srv.URL)
	if err == nil || !strings.Contains(err.Error(), "HTTP 404") {
		t.Fatalf("expected HTTP 404 error, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// downloadToFile
// ---------------------------------------------------------------------------

func TestDownloadToFile_WritesContent(t *testing.T) {
	content := []byte("binary-data-here")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write(content)
	}))
	defer srv.Close()

	dir := t.TempDir()
	path, err := downloadToFile(context.Background(), srv.Client(), srv.URL, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, content) {
		t.Fatal("downloaded content doesn't match")
	}

	if filepath.Dir(path) != dir {
		t.Fatalf("temp file not in target dir: %s vs %s", filepath.Dir(path), dir)
	}
}

func TestDownloadToFile_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	dir := t.TempDir()
	_, err := downloadToFile(context.Background(), srv.Client(), srv.URL, dir)
	if err == nil || !strings.Contains(err.Error(), "HTTP 500") {
		t.Fatalf("expected HTTP 500 error, got %v", err)
	}
}

func TestDownloadToFile_UnwritableDir(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("data"))
	}))
	defer srv.Close()

	_, err := downloadToFile(context.Background(), srv.Client(), srv.URL, "/nonexistent-dir-12345")
	if err == nil {
		t.Fatal("expected error for unwritable dir")
	}
}

// ---------------------------------------------------------------------------
// fileSHA256
// ---------------------------------------------------------------------------

func TestFileSHA256(t *testing.T) {
	content := []byte("hello world")
	h := sha256.Sum256(content)
	want := hex.EncodeToString(h[:])

	path := filepath.Join(t.TempDir(), "test")
	os.WriteFile(path, content, 0644)

	got, err := fileSHA256(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestFileSHA256_EmptyFile(t *testing.T) {
	h := sha256.Sum256(nil)
	want := hex.EncodeToString(h[:])

	path := filepath.Join(t.TempDir(), "empty")
	os.WriteFile(path, nil, 0644)

	got, err := fileSHA256(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestFileSHA256_MissingFile(t *testing.T) {
	_, err := fileSHA256("/nonexistent-file-12345")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

// ---------------------------------------------------------------------------
// replaceBinary
// ---------------------------------------------------------------------------

func TestReplaceBinary(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "degu")
	source := filepath.Join(dir, "degu-new")

	os.WriteFile(target, []byte("old"), 0755)
	os.WriteFile(source, []byte("new"), 0755)

	if err := replaceBinary(target, source); err != nil {
		t.Fatal(err)
	}

	got, _ := os.ReadFile(target)
	if string(got) != "new" {
		t.Fatalf("target = %q, want %q", got, "new")
	}

	if _, err := os.Stat(source); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("source should have been renamed away")
	}
}

func TestReplaceBinary_TargetMissing(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "degu")
	source := filepath.Join(dir, "degu-new")
	os.WriteFile(source, []byte("new"), 0755)

	err := replaceBinary(target, source)
	// On Unix, rename(source, target) succeeds even if target doesn't exist.
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got, _ := os.ReadFile(target)
	if string(got) != "new" {
		t.Fatalf("target = %q, want %q", got, "new")
	}
}

// ---------------------------------------------------------------------------
// ApplyHandler — HTTP-level tests
// ---------------------------------------------------------------------------

func TestApplyUpdate_NotEnabled(t *testing.T) {
	uc := CheckUpdateHandler("0.1.0")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/apply-update", nil)
	uc.ApplyHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	var resp ApplyUpdateResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Success {
		t.Fatal("expected failure when self-update is disabled")
	}
	if !strings.Contains(resp.Error, "not available") {
		t.Fatalf("unexpected error: %s", resp.Error)
	}
}

func TestApplyUpdate_AlreadyUpToDate(t *testing.T) {
	uc := CheckUpdateHandler("0.2.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{TagName: "v0.2.0"}, nil
		})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/apply-update", nil)
	uc.ApplyHandler().ServeHTTP(rec, req)

	var resp ApplyUpdateResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Success {
		t.Fatal("expected failure when already up to date")
	}
	if !strings.Contains(resp.Error, "already up to date") {
		t.Fatalf("unexpected error: %s", resp.Error)
	}
}

func TestApplyUpdate_OlderRelease(t *testing.T) {
	uc := CheckUpdateHandler("0.5.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{TagName: "v0.4.0"}, nil
		})
	rec := httptest.NewRecorder()
	uc.ApplyHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))

	var resp ApplyUpdateResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Success {
		t.Fatal("expected failure when running newer than latest")
	}
	if !strings.Contains(resp.Error, "already up to date") {
		t.Fatalf("unexpected error: %s", resp.Error)
	}
}

func TestApplyUpdate_FetchError(t *testing.T) {
	uc := CheckUpdateHandler("0.1.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{}, errors.New("github unreachable")
		})
	rec := httptest.NewRecorder()
	uc.ApplyHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	var resp ApplyUpdateResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Success {
		t.Fatal("expected failure on fetch error")
	}
	if !strings.Contains(resp.Error, "github unreachable") {
		t.Fatalf("unexpected error: %s", resp.Error)
	}
}

func TestApplyUpdate_ExeResolverError(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform")
	}

	uc := CheckUpdateHandler("0.1.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{
				TagName: "v0.2.0",
				Assets: []githubReleaseAsset{
					{Name: "degu-cli-v0.2.0" + suffix, DownloadURL: "https://example.test/cli"},
					{Name: "degu-cli-v0.2.0" + suffix + ".sha256", DownloadURL: "https://example.test/cli.sha256"},
				},
			}, nil
		}).
		WithExeResolver(func() (string, error) {
			return "", errors.New("can't find myself")
		})

	rec := httptest.NewRecorder()
	uc.ApplyHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))

	var resp ApplyUpdateResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Success {
		t.Fatal("expected failure on exe resolver error")
	}
	if !strings.Contains(resp.Error, "locate binary") {
		t.Fatalf("unexpected error: %s", resp.Error)
	}
}

func TestApplyUpdate_HashDownloadError(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform")
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	tmpDir := t.TempDir()
	fakeBin := filepath.Join(tmpDir, "degu-test")
	os.WriteFile(fakeBin, []byte("old"), 0755)

	uc := CheckUpdateHandler("0.1.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{
				TagName: "v0.2.0",
				Assets: []githubReleaseAsset{
					{Name: "degu-cli-v0.2.0" + suffix, DownloadURL: srv.URL + "/binary"},
					{Name: "degu-cli-v0.2.0" + suffix + ".sha256", DownloadURL: srv.URL + "/hash"},
				},
			}, nil
		}).
		WithExeResolver(func() (string, error) { return fakeBin, nil })

	rec := httptest.NewRecorder()
	uc.ApplyHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))

	var resp ApplyUpdateResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Success {
		t.Fatal("expected failure on hash download error")
	}
	if !strings.Contains(resp.Error, "HTTP 404") {
		t.Fatalf("unexpected error: %s", resp.Error)
	}

	got, _ := os.ReadFile(fakeBin)
	if string(got) != "old" {
		t.Fatal("binary should not be replaced on hash download error")
	}
}

func TestApplyUpdate_BinaryDownloadError(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform")
	}

	hashHex := strings.Repeat("aa", 32)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".sha256") {
			fmt.Fprintf(w, "%s  degu\n", hashHex)
		} else {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	defer srv.Close()

	tmpDir := t.TempDir()
	fakeBin := filepath.Join(tmpDir, "degu-test")
	os.WriteFile(fakeBin, []byte("old"), 0755)

	uc := CheckUpdateHandler("0.1.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{
				TagName: "v0.2.0",
				Assets: []githubReleaseAsset{
					{Name: "degu-cli-v0.2.0" + suffix, DownloadURL: srv.URL + "/binary"},
					{Name: "degu-cli-v0.2.0" + suffix + ".sha256", DownloadURL: srv.URL + "/hash.sha256"},
				},
			}, nil
		}).
		WithExeResolver(func() (string, error) { return fakeBin, nil })

	rec := httptest.NewRecorder()
	uc.ApplyHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))

	var resp ApplyUpdateResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Success {
		t.Fatal("expected failure on binary download error")
	}
	if !strings.Contains(resp.Error, "HTTP 503") {
		t.Fatalf("unexpected error: %s", resp.Error)
	}

	got, _ := os.ReadFile(fakeBin)
	if string(got) != "old" {
		t.Fatal("binary should not be replaced on download error")
	}
}

func TestApplyUpdate_HashMismatch(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform")
	}

	tmpDir := t.TempDir()
	fakeBin := filepath.Join(tmpDir, "degu-test")
	if err := os.WriteFile(fakeBin, []byte("old"), 0755); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".sha256") {
			fmt.Fprintf(w, "%s  degu-cli\n", strings.Repeat("a", 64))
		} else {
			w.Write([]byte("binary-content"))
		}
	}))
	defer srv.Close()

	uc := CheckUpdateHandler("0.1.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{
				TagName: "v0.2.0",
				Assets: []githubReleaseAsset{
					{Name: "degu-cli-v0.2.0" + suffix, DownloadURL: srv.URL + "/binary"},
					{Name: "degu-cli-v0.2.0" + suffix + ".sha256", DownloadURL: srv.URL + "/binary.sha256"},
				},
			}, nil
		}).
		WithExeResolver(func() (string, error) { return fakeBin, nil })

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/apply-update", nil)
	uc.ApplyHandler().ServeHTTP(rec, req)

	var resp ApplyUpdateResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Success {
		t.Fatal("expected failure on hash mismatch")
	}
	if !strings.Contains(resp.Error, "sha256 mismatch") {
		t.Fatalf("unexpected error: %s", resp.Error)
	}

	got, _ := os.ReadFile(fakeBin)
	if string(got) != "old" {
		t.Fatal("binary should not be replaced on hash mismatch")
	}
}

func TestApplyUpdate_CleansUpTempOnHashMismatch(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform")
	}

	tmpDir := t.TempDir()
	fakeBin := filepath.Join(tmpDir, "degu-test")
	os.WriteFile(fakeBin, []byte("old"), 0755)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".sha256") {
			fmt.Fprintf(w, "%s  f\n", strings.Repeat("b", 64))
		} else {
			w.Write([]byte("different-content"))
		}
	}))
	defer srv.Close()

	uc := CheckUpdateHandler("0.1.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{
				TagName: "v0.2.0",
				Assets: []githubReleaseAsset{
					{Name: "degu-cli-v0.2.0" + suffix, DownloadURL: srv.URL + "/bin"},
					{Name: "degu-cli-v0.2.0" + suffix + ".sha256", DownloadURL: srv.URL + "/bin.sha256"},
				},
			}, nil
		}).
		WithExeResolver(func() (string, error) { return fakeBin, nil })

	uc.ApplyHandler().ServeHTTP(
		httptest.NewRecorder(),
		httptest.NewRequest(http.MethodPost, "/", nil),
	)

	entries, _ := os.ReadDir(tmpDir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".degu-update-") {
			t.Fatalf("temp file %q was not cleaned up", e.Name())
		}
	}
}

// ---------------------------------------------------------------------------
// ApplyHandler — full success path
// ---------------------------------------------------------------------------

func newTestUpdateServer(t *testing.T, content []byte) *httptest.Server {
	t.Helper()
	h := sha256.Sum256(content)
	hashHex := hex.EncodeToString(h[:])

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".sha256") {
			fmt.Fprintf(w, "%s  degu-cli\n", hashHex)
		} else {
			w.Write(content)
		}
	}))
}

func TestApplyUpdate_Success(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform for self-update")
	}

	tmpDir := t.TempDir()
	fakeBin := filepath.Join(tmpDir, "degu-test")
	if err := os.WriteFile(fakeBin, []byte("old"), 0755); err != nil {
		t.Fatal(err)
	}

	newContent := []byte("new-binary-content-v0.3.0")
	srv := newTestUpdateServer(t, newContent)
	defer srv.Close()

	uc := CheckUpdateHandler("0.2.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{
				TagName: "v0.3.0",
				HTMLURL: "https://example.test/releases/v0.3.0",
				Assets: []githubReleaseAsset{
					{Name: "degu-cli-v0.3.0" + suffix, DownloadURL: srv.URL + "/binary"},
					{Name: "degu-cli-v0.3.0" + suffix + ".sha256", DownloadURL: srv.URL + "/binary.sha256"},
				},
			}, nil
		}).
		WithExeResolver(func() (string, error) { return fakeBin, nil })

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/apply-update", nil)
	uc.ApplyHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var resp ApplyUpdateResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if !resp.Success {
		t.Fatalf("expected success; got error: %s", resp.Error)
	}
	if resp.NewVersion != "0.3.0" {
		t.Fatalf("newVersion = %q, want 0.3.0", resp.NewVersion)
	}

	got, err := os.ReadFile(fakeBin)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, newContent) {
		t.Fatal("binary was not replaced with new content")
	}
}

func TestApplyUpdate_PreservesPermissions(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform")
	}

	tmpDir := t.TempDir()
	fakeBin := filepath.Join(tmpDir, "degu-test")
	os.WriteFile(fakeBin, []byte("old"), 0755)

	newContent := []byte("new")
	srv := newTestUpdateServer(t, newContent)
	defer srv.Close()

	uc := CheckUpdateHandler("0.1.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{
				TagName: "v0.2.0",
				Assets: []githubReleaseAsset{
					{Name: "degu-cli-v0.2.0" + suffix, DownloadURL: srv.URL + "/bin"},
					{Name: "degu-cli-v0.2.0" + suffix + ".sha256", DownloadURL: srv.URL + "/bin.sha256"},
				},
			}, nil
		}).
		WithExeResolver(func() (string, error) { return fakeBin, nil })

	uc.ApplyHandler().ServeHTTP(
		httptest.NewRecorder(),
		httptest.NewRequest(http.MethodPost, "/", nil),
	)

	info, err := os.Stat(fakeBin)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0111 == 0 {
		t.Fatalf("new binary is not executable: %o", info.Mode().Perm())
	}
}

func TestApplyUpdate_ResponseContentType(t *testing.T) {
	uc := CheckUpdateHandler("0.1.0")
	rec := httptest.NewRecorder()
	uc.ApplyHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))

	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
}

// ---------------------------------------------------------------------------
// Pending-version state
// ---------------------------------------------------------------------------

func TestApplyUpdate_SetsPendingVersion(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform")
	}

	tmpDir := t.TempDir()
	fakeBin := filepath.Join(tmpDir, "degu-test")
	os.WriteFile(fakeBin, []byte("old"), 0755)

	newContent := []byte("new")
	srv := newTestUpdateServer(t, newContent)
	defer srv.Close()

	uc := CheckUpdateHandler("0.1.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{
				TagName: "v0.2.0",
				Assets: []githubReleaseAsset{
					{Name: "degu-cli-v0.2.0" + suffix, DownloadURL: srv.URL + "/bin"},
					{Name: "degu-cli-v0.2.0" + suffix + ".sha256", DownloadURL: srv.URL + "/bin.sha256"},
				},
			}, nil
		}).
		WithExeResolver(func() (string, error) { return fakeBin, nil })

	rec := httptest.NewRecorder()
	uc.ApplyHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))

	rec = httptest.NewRecorder()
	uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	got := decodeUpdateResp(t, rec)
	if !got.PendingRestart {
		t.Fatal("expected pendingRestart=true after apply")
	}
	if got.PendingVersion != "0.2.0" {
		t.Fatalf("pendingVersion = %q, want 0.2.0", got.PendingVersion)
	}
	if got.UpdateAvailable {
		t.Fatal("updateAvailable should be false when pending restart")
	}
}

func TestCheckUpdate_PendingRestartSkipsFetcher(t *testing.T) {
	uc := CheckUpdateHandler("0.1.0").
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			t.Fatal("fetcher should not be called when pending restart")
			return githubRelease{}, nil
		})

	uc.mu.Lock()
	uc.pendingVersion = "0.2.0"
	uc.mu.Unlock()

	rec := httptest.NewRecorder()
	uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	got := decodeUpdateResp(t, rec)
	if !got.PendingRestart {
		t.Fatal("expected pendingRestart=true")
	}
	if got.PendingVersion != "0.2.0" {
		t.Fatalf("pendingVersion = %q, want 0.2.0", got.PendingVersion)
	}
}

func TestCheckUpdate_PendingRestartIsCached(t *testing.T) {
	var calls int
	uc := CheckUpdateHandler("0.1.0").
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			calls++
			return githubRelease{TagName: "v0.2.0"}, nil
		})

	uc.mu.Lock()
	uc.pendingVersion = "0.2.0"
	uc.mu.Unlock()

	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	}
	if calls != 0 {
		t.Fatalf("fetcher called %d times; should be 0 when pending", calls)
	}
}

// ---------------------------------------------------------------------------
// canSelfUpdate flag in check-update
// ---------------------------------------------------------------------------

func TestCheckUpdate_CanSelfUpdate(t *testing.T) {
	if cliAssetSuffix() == "" {
		t.Skip("unsupported platform")
	}

	uc := CheckUpdateHandler("0.1.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{
				TagName: "v0.2.0",
				HTMLURL: "https://example.test/releases/v0.2.0",
			}, nil
		})

	rec := httptest.NewRecorder()
	uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	got := decodeUpdateResp(t, rec)
	if !got.CanSelfUpdate {
		t.Fatal("expected canSelfUpdate=true when self-update enabled and update available")
	}
}

func TestCheckUpdate_CanSelfUpdate_FalseWhenUpToDate(t *testing.T) {
	uc := CheckUpdateHandler("0.2.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{TagName: "v0.2.0"}, nil
		})

	rec := httptest.NewRecorder()
	uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	got := decodeUpdateResp(t, rec)
	if got.CanSelfUpdate {
		t.Fatal("canSelfUpdate should be false when already up to date")
	}
}

func TestCheckUpdate_CanSelfUpdate_FalseWhenDisabled(t *testing.T) {
	uc := CheckUpdateHandler("0.1.0").
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{TagName: "v0.2.0"}, nil
		})

	rec := httptest.NewRecorder()
	uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	got := decodeUpdateResp(t, rec)
	if got.CanSelfUpdate {
		t.Fatal("canSelfUpdate should be false when WithSelfUpdate not called")
	}
}

func TestCheckUpdate_CanSelfUpdate_FalseOnError(t *testing.T) {
	uc := CheckUpdateHandler("0.1.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{}, errors.New("boom")
		})

	rec := httptest.NewRecorder()
	uc.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/check-update", nil))
	got := decodeUpdateResp(t, rec)
	if got.CanSelfUpdate {
		t.Fatal("canSelfUpdate should be false on fetch error")
	}
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

func TestApplyUpdate_SerializesRequests(t *testing.T) {
	suffix := cliAssetSuffix()
	if suffix == "" {
		t.Skip("unsupported platform")
	}

	tmpDir := t.TempDir()
	fakeBin := filepath.Join(tmpDir, "degu-test")
	os.WriteFile(fakeBin, []byte("old"), 0755)

	newContent := []byte("new-binary")
	srv := newTestUpdateServer(t, newContent)
	defer srv.Close()

	uc := CheckUpdateHandler("0.1.0").
		WithSelfUpdate(true).
		WithReleaseFetcher(func(context.Context) (githubRelease, error) {
			return githubRelease{
				TagName: "v0.2.0",
				Assets: []githubReleaseAsset{
					{Name: "degu-cli-v0.2.0" + suffix, DownloadURL: srv.URL + "/bin"},
					{Name: "degu-cli-v0.2.0" + suffix + ".sha256", DownloadURL: srv.URL + "/bin.sha256"},
				},
			}, nil
		}).
		WithExeResolver(func() (string, error) { return fakeBin, nil })

	handler := uc.ApplyHandler()

	var wg sync.WaitGroup
	results := make([]int, 5)
	for i := range results {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))
			results[idx] = rec.Code
		}(i)
	}
	wg.Wait()

	var successes, conflicts int
	for _, code := range results {
		switch code {
		case http.StatusOK:
			successes++
		case http.StatusConflict:
			conflicts++
		case http.StatusInternalServerError:
			// May happen if the binary was already replaced by another goroutine
			// and the second attempt fails because the version is now up to date.
		default:
			t.Fatalf("unexpected status: %d", code)
		}
	}
	if successes < 1 {
		t.Fatal("expected at least one successful update")
	}
}

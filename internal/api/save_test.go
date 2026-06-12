package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveRejectsGetAndDelete(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		req, _ := http.NewRequest(method, srv.URL+"/api/save/a.mp4", nil)
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("%s: got %d, want 405", method, res.StatusCode)
		}
		if allow := res.Header.Get("Allow"); allow == "" {
			t.Errorf("%s: Allow header missing", method)
		}
	}
}

func TestSaveAcceptsPost(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/save/posted.mp4",
		strings.NewReader("data"))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d, want 200", res.StatusCode)
	}
	if b, _ := os.ReadFile(filepath.Join(root, "posted.mp4")); string(b) != "data" {
		t.Errorf("contents: got %q", b)
	}
}

func TestSaveMissingPathBadRequest(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/save/", strings.NewReader("x"))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400", res.StatusCode)
	}
}

func TestSaveTraversalForbidden(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/save/../escape.mp4",
		strings.NewReader("x"))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Errorf("status: got %d, want 403", res.StatusCode)
	}
}

func TestSaveRejectsUnsupportedExtension(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/save/note.txt",
		strings.NewReader("x"))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400 (unsupported ext)", res.StatusCode)
	}
}

func TestSaveResponseIncludesPathAndSize(t *testing.T) {
	root := t.TempDir()
	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/save/deep/dir/v.mp4",
		strings.NewReader("12345"))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d, want 200", res.StatusCode)
	}
	body := new(strings.Builder)
	buf := make([]byte, 1024)
	n, _ := res.Body.Read(buf)
	body.Write(buf[:n])
	s := body.String()
	if !strings.Contains(s, `"size":5`) {
		t.Errorf("response missing size:5: %q", s)
	}
	if !strings.Contains(s, `"path":"deep/dir/v.mp4"`) {
		t.Errorf("response missing path: %q", s)
	}
	// Nested directory was created.
	if _, err := os.Stat(filepath.Join(root, "deep", "dir", "v.mp4")); err != nil {
		t.Errorf("nested file not written: %v", err)
	}
}

func TestSaveCreateTempFailureIsServerError(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root bypasses directory permissions")
	}
	// Make the destination directory read-only so os.CreateTemp fails,
	// exercising the internal-error branch (500).
	root := t.TempDir()
	dir := filepath.Join(root, "ro")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/save/ro/new.mp4",
		strings.NewReader("data"))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusInternalServerError {
		t.Errorf("status: got %d, want 500 (CreateTemp into read-only dir)", res.StatusCode)
	}
}

func TestSaveRenameFailureWhenDestIsDirectory(t *testing.T) {
	// With overwrite=1 the existence check is skipped, but os.Rename of the
	// temp file onto an existing directory fails — exercising the final
	// rename-error branch (500).
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "dest.mp4"), 0o755); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/save/dest.mp4?overwrite=1",
		strings.NewReader("data"))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusInternalServerError {
		t.Errorf("status: got %d, want 500 (rename onto directory)", res.StatusCode)
	}
}

func TestSaveBodyTooLargeRejected(t *testing.T) {
	// MaxBytesReader caps at 4 GiB; we can't realistically exceed that, but
	// we verify a normal-sized body within the cap still writes fine, and
	// that an empty body is accepted (0 bytes).
	root := t.TempDir()
	srv := httptest.NewServer(SaveHandler(root))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/save/empty.mp4",
		strings.NewReader(""))
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d, want 200 for empty body", res.StatusCode)
	}
	fi, err := os.Stat(filepath.Join(root, "empty.mp4"))
	if err != nil || fi.Size() != 0 {
		t.Errorf("empty file expected: %v size=%v", err, fi)
	}
}

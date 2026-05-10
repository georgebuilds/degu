package server

import (
	"os/exec"
	"runtime"
)

// OpenBrowser opens url in the user's default browser.
//
// Reaps the launcher in a goroutine so the spawned process doesn't leak — per
// os/exec docs, every Start needs a paired Wait or Release to free the
// process handle and (on Unix) avoid a zombie.
func OpenBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

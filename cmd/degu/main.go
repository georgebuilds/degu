package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/georgebuilds/degu/internal/db"
	"github.com/georgebuilds/degu/internal/server"
)

const (
	defaultPort = 7878
	maxPortTry  = 32
)

func main() {
	var (
		port      = flag.Int("port", defaultPort, "TCP port to listen on (auto-fallback if busy)")
		host      = flag.String("host", "127.0.0.1", "interface to bind")
		noBrowser = flag.Bool("no-browser", false, "do not open the browser on launch")
		showVer   = flag.Bool("version", false, "print version and exit")
	)
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: degu [flags] [path]\n\n")
		fmt.Fprintf(os.Stderr, "  path defaults to the current working directory.\n\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	if *showVer {
		fmt.Println("degu", buildVersion())
		return
	}

	root, err := resolveRoot(flag.Arg(0))
	if err != nil {
		log.Fatalf("degu: %v", err)
	}

	bootCtx, cancelBoot := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelBoot()
	store, err := db.Open(bootCtx, root)
	if err != nil {
		log.Fatalf("degu: %v", err)
	}
	defer store.Close()

	listener, addr, err := listen(*host, *port)
	if err != nil {
		log.Fatalf("degu: %v", err)
	}

	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		log.Fatalf("degu: split addr %q: %v", addr, err)
	}
	boundPort, err := strconv.Atoi(portStr)
	if err != nil {
		log.Fatalf("degu: parse port %q: %v", portStr, err)
	}

	srv := server.New(server.Config{
		Root:              root,
		Version:           buildVersion(),
		DB:                store,
		Port:              boundPort,
		EnableOriginGuard: true,
		SelfUpdate:        true,
	})

	httpServer := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	url := fmt.Sprintf("http://%s/", addr)
	fmt.Printf("degu %s\n", buildVersion())
	fmt.Printf("  root  %s\n", root)
	fmt.Printf("  url   %s\n", url)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("degu: serve: %v", err)
		}
	}()

	if !*noBrowser {
		if err := server.OpenBrowser(url); err != nil {
			fmt.Fprintf(os.Stderr, "degu: could not open browser: %v\n  open this URL manually: %s\n", err, url)
		}
	}

	<-ctx.Done()
	fmt.Println("\ndegu: shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
}

func resolveRoot(arg string) (string, error) {
	if arg == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", fmt.Errorf("resolve cwd: %w", err)
		}
		arg = cwd
	}
	abs, err := filepath.Abs(arg)
	if err != nil {
		return "", fmt.Errorf("resolve %q: %w", arg, err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("stat %q: %w", abs, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%q is not a directory", abs)
	}
	return abs, nil
}

func listen(host string, startPort int) (net.Listener, string, error) {
	for offset := 0; offset < maxPortTry; offset++ {
		port := startPort + offset
		addr := fmt.Sprintf("%s:%d", host, port)
		l, err := net.Listen("tcp", addr)
		if err == nil {
			return l, addr, nil
		}
	}
	return nil, "", fmt.Errorf("no free port in range %d-%d", startPort, startPort+maxPortTry-1)
}

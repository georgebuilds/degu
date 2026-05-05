package main

// version is overridden at link time via -ldflags "-X main.version=…".
var version = "dev"

func buildVersion() string {
	return version
}

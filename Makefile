.PHONY: build cli app dev test test-go test-js clean install

VERSION ?= dev
BIN     := bin/degu
LDFLAGS := -s -w -X main.version=$(VERSION)

# Default = the desktop .app (Wails). `make cli` builds the headless CLI.
build: app

app: ## Wails-wrapped macOS .app at build/bin/degu.app
	@wails build -platform darwin/arm64 -ldflags "$(LDFLAGS)"
	@echo "==> build/bin/degu.app ($(VERSION))"

cli: ## headless CLI binary at bin/degu (no Wails)
	@npm run build:embed
	@mkdir -p bin
	@go build -trimpath -ldflags "$(LDFLAGS)" -o $(BIN) ./cmd/degu
	@echo "==> $(BIN) ($(VERSION))"

dev: ## Wails dev server with HMR
	@wails dev

test: test-js test-go

test-go:
	@go test ./...

test-js:
	@npm test

install: cli
	@install -m 0755 $(BIN) $${HOME}/.local/bin/degu
	@echo "==> installed to $${HOME}/.local/bin/degu"

clean:
	@rm -rf bin dist build/bin internal/server/static/index.html

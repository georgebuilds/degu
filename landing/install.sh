#!/usr/bin/env bash
# install.sh — install degu.app on macOS Apple Silicon.
#
# Run with:
#   curl -fsSL https://georgebuilds.github.io/degu/install.sh | sh
#
# What this does, in order:
#   1. Refuses to continue on anything that isn't macOS arm64 (the only
#      architecture v0.1 releases support).
#   2. Downloads the latest release .zip from github.com/georgebuilds/degu.
#   3. Extracts degu.app into /Applications (or ~/Applications when
#      /Applications isn't writable).
#   4. Strips the Gatekeeper quarantine xattr so the first launch doesn't
#      require a right-click → Open dance. The .app is self-signed but not
#      notarised; a future commit will add a Developer ID.
#   5. Opens degu.app.
#
# The script is intentionally short and re-readable. Audit before piping
# into a shell.

set -euo pipefail

REPO="georgebuilds/degu"
RELEASE_API="https://api.github.com/repos/${REPO}/releases/latest"

red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
plain()  { printf '%s\n' "$*"; }

# 1. Platform check ----------------------------------------------------------
os="$(uname -s)"
arch="$(uname -m)"
if [ "$os" != "Darwin" ]; then
  red "degu installer: macOS only (got $os)."
  exit 1
fi
if [ "$arch" != "arm64" ]; then
  red "degu installer: Apple Silicon only (got $arch)."
  red "v0.1 doesn't ship Intel binaries. Build from source: https://github.com/${REPO}"
  exit 1
fi

# 2. Find the asset ----------------------------------------------------------
plain "==> resolving latest release"
asset_url="$(curl -fsSL "$RELEASE_API" \
  | awk -F'"' '/browser_download_url/ && /darwin-arm64\.zip"/ {print $4; exit}')"

if [ -z "$asset_url" ]; then
  red "degu installer: no darwin-arm64.zip asset on the latest release."
  exit 1
fi
plain "    $asset_url"

# 3. Download + extract ------------------------------------------------------
work="$(mktemp -d -t degu-install)"
trap 'rm -rf "$work"' EXIT
plain "==> downloading"
curl -fL "$asset_url" -o "$work/degu.zip"

plain "==> extracting"
# `ditto` is macOS' archive tool — it handles the metadata-preserving zip
# format Wails uses far better than `unzip` does.
ditto -x -k "$work/degu.zip" "$work/extracted"

src=""
if [ -d "$work/extracted/degu.app" ]; then
  src="$work/extracted/degu.app"
elif [ -d "$work/extracted/Payload/degu.app" ]; then
  src="$work/extracted/Payload/degu.app"
else
  found="$(find "$work/extracted" -maxdepth 3 -name 'degu.app' -type d | head -n1)"
  if [ -n "$found" ]; then src="$found"; fi
fi
if [ -z "$src" ] || [ ! -d "$src" ]; then
  red "degu installer: couldn't locate degu.app inside the archive."
  exit 1
fi

# 4. Move into place ---------------------------------------------------------
dest="/Applications"
if [ ! -w "$dest" ]; then
  dest="$HOME/Applications"
  mkdir -p "$dest"
  yellow "    /Applications not writable — installing to $dest instead"
fi

if [ -d "$dest/degu.app" ]; then
  yellow "    replacing existing $dest/degu.app"
  rm -rf "$dest/degu.app"
fi
ditto "$src" "$dest/degu.app"

# 5. Quarantine + launch -----------------------------------------------------
xattr -dr com.apple.quarantine "$dest/degu.app" 2>/dev/null || true

green "==> installed"
plain "    $dest/degu.app"
plain ""
plain "Launching now. Pass a folder later with:"
plain "  open -a degu --args /path/to/folder"
plain ""

open "$dest/degu.app"

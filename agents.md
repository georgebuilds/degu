# agents.md — degu

Guidance for AI coding agents working on this repository.

## What this project is

**degu** is a **local-first media browser**: browse, search, preview, tag, A–B-loop, trim, and rename media files without uploading anything. It runs in two modes:

- **App / server mode** (primary): a local Go server (`internal/server`) serves the SPA and all `/api/*` routes. Distributed as a **Wails desktop app** (`main.go`, macOS arm64) and a headless **CLI binary** (`cmd/degu/`, cross-platform). Tags and video loops are stored in a **SQLite database** (`internal/db`) next to the media root. The SPA auto-detects the server via `/api/info` on boot.

- **Drop-on-drive mode** (FSA fallback): when no Go server is reachable, the SPA uses the browser's **File System Access API** to read the folder directly and writes tags to **`index.json`** at the root. Works in Chromium-based browsers with `showDirectoryPicker`.

Both modes share the same `index.json` on-disk format so a folder can be used in either mode interchangeably.

**Browser support for FSA mode:** Chromium-based browsers with `showDirectoryPicker` / `FileSystemDirectoryHandle` / `FileSystemFileHandle.move` / `showSaveFilePicker` and cross-origin isolation (for `@ffmpeg/core-mt`). Not Safari/Firefox.

## Stack

| Layer | Choice |
|--------|--------|
| UI | **Preact** 10 (`preact/hooks`, `preact/compat` for `memo`) |
| Build | **Vite** 8, **TypeScript** |
| Styling | **Tailwind CSS** v4 (`@tailwindcss/vite`), utility classes in JSX (`class=`) |
| Output | **Single-file** bundle (`vite-plugin-singlefile`) — inlined JS/CSS in `dist/index.html`; embedded in the Go binary via `internal/server/embed.go` |
| Video trim | **`@ffmpeg/ffmpeg`** + **`@ffmpeg/core-mt`** (CDN, version pinned in `video-trim-scope.ts`) + **`@ffmpeg/util`** |
| Tests | **Vitest** 4 (default `node`; component tests opt into `happy-dom` via `@vitest-environment` directive) + **`@testing-library/preact`** |
| Go server | **Go 1.25**, stdlib `net/http` |
| Database | **SQLite** via `modernc.org/sqlite` (pure Go, no CGO) |
| Desktop app | **Wails v2** (macOS arm64 `WKWebView` wrapper) |

## Commands

```bash
npm install          # JS dependencies
npm run dev          # Vite dev server (FSA mode — no Go server)
npm run build        # tsc -b && vite build — must pass before finishing
npm run preview      # serve production SPA bundle locally
npm test             # Vitest run (CI mode)
npm run test:watch   # Vitest watch
```

Run **`npm run build`** after substantive changes to ensure TypeScript and the bundle succeed.

## Repository layout

```
main.go              # Wails entry point (macOS arm64 desktop app)
cmd/degu/            # Headless CLI binary — serves SPA + /api/* on localhost:7878
internal/
  server/            # HTTP handler: embeds SPA bundle, routes /api/*, sets COOP/COEP headers
  db/                # SQLite store (tags, video loops, timestamps) + legacy index.json importer
  api/               # /api/* route handlers: scan, tags, stats, thumb, file, move

src/
  app.tsx              # Boot: detect HTTP driver → FSA reconnect → FSA pick → fail
  main.tsx             # Entry
  fs-access.d.ts       # File System Access API ambient types
  components/
    AppShell.tsx                 # Top-level layout once connected: mode rail + screen switcher
    StarField.tsx                # Animated star background used on boot screens
    ModeRail.tsx                 # Vertical icon rail — switches between triage / library / tags modes
    Burroughs.tsx                # Brand mascot SVG; used in empty states and reward screens
    FileBrowser.tsx              # Library mode: list/thumb views, search, sidebar tag filter, viewer pane, modal hosts
    FileRow.tsx                  # List-view row (file or directory) + FileListItem / DirListItem types
    FileThumbnail.tsx            # Thumbnail-view cell (image bitmap downscale, video poster fallback)
    Sidebar.tsx                  # Search box, media-kind filter, tag list with counts, breadcrumb
    PreviewModal.tsx             # Image / video preview, A–B loops, trim export, quick-add tag chips
    PreviewModal.test.tsx        # DOM render test (happy-dom)
    ViewerPane.tsx               # Right-side multi-cell pinned viewer; reuses useVideoABLoop for saved loops
    TagsModal.tsx                # Edit tags for one or many files (TagEditor host)
    TagEditor.tsx                # Tag chip editor + datalist autocomplete
    TagEditor.test.tsx           # DOM render test (happy-dom)
    TagsScreen.tsx               # Tag vocabulary manager: all tags with counts, creation dates, stale-file indicators
    TriageScreen.tsx             # Primary mode: card-by-card tagging of stale / untagged files
    MoreTagsQuickAddDropdown.tsx # "More" submenu used by quick-add menus and pill rows
    NewTagQuickAddDialog.tsx     # Dialog for creating a new tag from the quick-add UI
    NormalizeFilenamesModal.tsx  # Configure → run → report flow for bulk filename rewrite
    ScrubMetadataModal.tsx       # Strip / modify EXIF + container metadata (bulk or single file)
    StorageStatsModal.tsx        # Storage breakdown by kind / extension / tag
    FileContextMenu.tsx          # Generic positioned context menu container
    ProgressBar.tsx              # Determinate / indeterminate bar (modals, scans)
  lib/
    storage-driver.ts   # StorageDriver interface + DriverCapabilities + module-level active singleton
    fsa-driver.ts       # FsaDriver: FSA-backed driver — tags persisted to index.json at root
    http-driver.ts      # HttpDriver: Go-server-backed driver — tags via /api/tags, server-side optimisations
    tags.ts             # In-memory tag + video-loop store; routes reads/writes through the active driver
    index-json.ts       # Pure parse/serialize for the shared index.json format (tags + `__degu` meta block)
    patch-tag-index.ts  # Incremental inverted-index updates after a single-path tag edit
    root-tag-index.ts   # Full-tree walk + inverted index (fallback / deep resync)
    tag-filter-paths.ts # Pure: paths matching all tags, selectable-tag set, untagged set from inverted index
    files-matching-tags.ts # Walk-based fallback: files with required tags or fully untagged
    media-paths.ts      # Recursive enumeration of media paths under root (full + untagged variants)
    tag-key.ts          # Stack + name → path-relative-to-root storage key
    recent-tags.ts      # `localStorage` MRU of applied tags + visible-strip cap
    more-quick-add-tags.ts # Pure: build the "More" lists merging recent overflow with index tags
    supported-media.ts  # Whitelisted image / video extensions; MediaKindFilter helpers
    preview.ts          # filename → 'image' | 'video' | null
    recursive-scan.ts   # Name search walk: dirs + files matching a query, with progress + cancel
    resolve-path.ts     # Path string → FileSystemFileHandle / FileListItem (and parent + filename)
    resolve-directory-stack.ts # Path segments → directory handle stack (breadcrumb)
    hash-location.ts    # Hash ↔ path segments in the URL bar
    handle-store.ts     # IndexedDB persistence of the FSA root handle (FSA mode only)
    http-handles.ts     # FSA-shaped shims over HTTP: HttpFileHandle / HttpDirectoryHandle dispatch to /api/*
    api-client.ts       # fetch wrappers for all /api/* endpoints
    throttle.ts         # throttleVoid / throttle / mapWithConcurrency
    format-bytes.ts     # Human-readable byte size
    format-media-time.ts # Seconds → m:ss / h:mm:ss
    storage-stats.ts    # One walk → totalBytes, byKind, byExtension, byTag, untaggedBytes
    normalize-filenames.ts # Plan + execute bulk substring removal in basenames; rewrites tag keys; flushes index
    scrub-metadata.ts   # Plan + execute strip / modify of EXIF + container metadata via ffmpeg.wasm
    ffmpeg-scrub.ts     # Thin ffmpeg-core wrapper: `-map_metadata -1 -c copy` (strip) or `-metadata k=v` (modify)
    ffmpeg-trim.ts      # Lazy-load `@ffmpeg/core-mt` from CDN, run `-c copy` stream-copy trim
    video-trim-scope.ts # FFmpeg core version pin + MAX_TRIM_INPUT_BYTES (~512 MiB)
    video-trim-estimate.ts # Heuristic kept-bytes / saved-bytes estimate for UI
    video-ab-loop.ts    # `useVideoABLoop` hook + VIDEO_AB_LOOP_EPS (PreviewModal + ViewerPane)
    save-trimmed-video.ts  # Write trimmed blob to sibling folder, else `showSaveFilePicker`
    tag-color.ts        # Deterministic tag → colour mapping
    use-blob-url.ts     # Hook: object URL from a FileSystemFileHandle, revoked on unmount
    use-focus-trap.ts   # Hook: trap keyboard focus inside a modal container
    use-recent-tags.ts  # Hook: subscribe to the recent-tags MRU list
    use-tag-index-version.ts # Hook: re-render when the in-memory tag index mutates
```

## Domain concepts

### Boot and driver selection

On load, `app.tsx` runs this sequence:
1. `HttpDriver.detect()` — probes `/api/info`. Succeeds when the Go server is running (Wails app, headless CLI). Sets the active driver and calls `initTagIndex()`.
2. If no server: check for a stored FSA handle in IndexedDB. If permission is `granted`, create an `FsaDriver` and connect. If `prompt`, show a "reconnect" button so the user re-grants from a click. If `denied`, drop the handle.
3. If no stored handle: show a folder picker (`FsaDriver.connect()`).
4. If FSA is unsupported and no server: show an error with the `degu /path` CLI hint.

All driver-agnostic code calls `getActiveDriver()` from `storage-driver.ts`; `tags.ts` uses it to dispatch reads and writes without knowing which driver is connected.

### Connected root

The user is scoped to **one** folder (`rootHandle`). Paths used for tags and search are **relative to that folder** (e.g. `src/app.php`), joined with `/`.

In HTTP mode, `rootHandle` is an `HttpDirectoryHandle` that dispatches filesystem calls to `/api/*`. In FSA mode it is a real `FileSystemDirectoryHandle`. Component code is driver-agnostic — it programs against the FSA-shaped surface either way.

### URL hash and navigation

The current folder under the connected root is reflected in the **location hash** (e.g. `#/photos/2024`). Opening a subfolder uses **`history.pushState`** so the **browser Back** button moves to the parent folder; breadcrumb jumps use **`replaceState`** so they do not add extra history entries. Picking a new root folder remounts `FileBrowser` and resets the hash to `#/`.

### Tag and video-loop storage

Tags and video loops are stored in **two equivalent formats**, one per mode:

- **HTTP mode** — `internal/db` SQLite database next to the root. The Go server exposes the full payload via `GET /api/tags` (flat JSON) and accepts `PUT /api/tags` to persist. `HttpDriver` converts the flat wire format into the same `TagPayload` shape `FsaDriver` uses.
- **FSA mode** — `index.json` at the connected root. Keys are `tagStorageKey` (path relative to root, `/`-separated) → `string[]`. Video loops and timestamps live under the reserved key `__degu` → `{ videoLoops, tagCreatedAt, lastReviewed }`.

Both formats are normalised by `parseIndexPayload` / `buildIndexJsonObject` in `index-json.ts`. A folder used in HTTP mode and later opened in FSA mode (or vice-versa) sees the same tag state — `MaybeImportLegacyIndex` in `internal/db` reads `index.json` on first connect.

Edits are **debounced** to disk/server (400 ms); `flushTagIndex` runs on `pagehide`.

### Sidebar vs tag filter performance

- After `initTagIndex`, `buildAggregateFromTagIndex` builds `tagToPaths` and counts from the in-memory map — no filesystem walk on reload.
- Single-path edits patch the inverted index via `patchTagIndexAfterEdit` (no rescan).
- `aggregateTagsUnderRoot` in `root-tag-index.ts` still walks the tree; kept as fallback / deep-resync tooling.

### App modes

`AppShell` exposes three modes via `ModeRail`:
- **Triage** (default) — card-by-card tagging of stale/untagged files (`TriageScreen`). The primary verb.
- **Library** — full file browser with list/thumb views, search, tag filter, viewer pane, and modals (`FileBrowser`).
- **Tags** — tag vocabulary manager: all tags with counts, creation dates, and stale-file indicators (`TagsScreen`).

### Video loops and trim

- Users save multiple **loops** per video (start/end times) from `PreviewModal`; `useVideoABLoop` constrains playback. Same hook powers loops pinned to `ViewerPane`.
- **Trim export** (`-c copy` via `ffmpeg.wasm`, lazy-loaded from CDN) writes a sibling file when possible, else falls back to `showSaveFilePicker`. Stream-copy snaps cuts to keyframes; size limit is `MAX_TRIM_INPUT_BYTES` (~512 MiB).

### Storage stats and filename normalization

- `StorageStatsModal` runs `computeStorageStats` (one tree walk) for byte totals broken down by kind, extension, tag, and untagged.
- `NormalizeFilenamesModal` drives `runNormalizeFilenames`: collect paths, plan substring removals, rename via `FileSystemFileHandle.move` (or `/api/move/batch` in HTTP mode), rewrite tag keys, flush.
- `ScrubMetadataModal` drives `runScrubMetadata`: collect paths (or use caller-supplied list), call `ffmpeg.wasm` with `-map_metadata -1 -c copy` (strip) or `-metadata k=v` (modify), then overwrite the original via `createWritable`. Modify is **video-only** in v1 — images skip the per-file modify call; a follow-up will add JPEG/PNG EXIF write paths.

## Conventions for changes

1. **Match existing style:** Preact + hooks, Tailwind classes, no new UI framework.
2. **Keep diffs focused** on the task; avoid drive-by refactors or unrelated files.
3. **Do not add** markdown/docs files unless the user asks (this file and `README.md` are exceptions).
4. **File System Access** APIs are async; preserve cancellation patterns (`cancelled` flags in `useEffect`, `AbortSignal` for long scans/trim) where already used.
5. **Pure helpers go in `src/lib/`** with a sibling `*.test.ts`. Component tests use `@testing-library/preact` and a per-file `/** @vitest-environment happy-dom */` directive.
6. **Bumping the FFmpeg core version** requires changing `FFMPEG_CORE_MT_VERSION` in `video-trim-scope.ts` (which is also where the CDN URL in `ffmpeg-trim.ts` reads from).
7. **StorageDriver contract**: new features that need filesystem or persistence access should go through the active driver (`getActiveDriver()`), not directly to FSA or fetch. Add optional capability flags to `DriverCapabilities` when a feature is HTTP-only.

## Testing

- **`npm test`** (Vitest, `src/**/*.test.ts` + `src/**/*.test.tsx`). Default environment is `node`; tests that render components opt into `happy-dom` via `/** @vitest-environment happy-dom */` at the top of the file.
- **`npm run build`** must still pass after changes; there is no automated browser/e2e suite.
- **Covered** (pure helpers + component tests):
  [`index-json`](src/lib/index-json.test.ts),
  [`tag-key`](src/lib/tag-key.test.ts),
  [`recent-tags`](src/lib/recent-tags.test.ts),
  [`supported-media`](src/lib/supported-media.test.ts),
  [`hash-location`](src/lib/hash-location.test.ts),
  [`throttle`](src/lib/throttle.test.ts),
  [`format-bytes`](src/lib/format-bytes.test.ts),
  [`format-media-time`](src/lib/format-media-time.test.ts),
  [`storage-stats`](src/lib/storage-stats.test.ts),
  [`tag-filter-paths`](src/lib/tag-filter-paths.test.ts),
  [`more-quick-add-tags`](src/lib/more-quick-add-tags.test.ts),
  [`patch-tag-index`](src/lib/patch-tag-index.test.ts),
  [`tag-color`](src/lib/tag-color.test.ts),
  [`media-paths`](src/lib/media-paths.test.ts),
  [`recursive-scan`](src/lib/recursive-scan.test.ts),
  [`normalize-filenames`](src/lib/normalize-filenames.test.ts),
  [`scrub-metadata`](src/lib/scrub-metadata.test.ts),
  [`video-trim-estimate`](src/lib/video-trim-estimate.test.ts),
  [`video-trim-scope`](src/lib/video-trim-scope.test.ts),
  [`video-ab-loop`](src/lib/video-ab-loop.test.ts),
  [`save-trimmed-video`](src/lib/save-trimmed-video.test.ts),
  [`PreviewModal`](src/components/PreviewModal.test.tsx),
  [`TagEditor`](src/components/TagEditor.test.tsx).

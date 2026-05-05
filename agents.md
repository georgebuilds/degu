# agents.md — degu

Guidance for AI coding agents working on this repository.

## What this project is

**degu** is a **local file browser** SPA: users grant access to a folder via the **File System Access API**, then browse, search, preview media, tag files, save A–B video loops, trim videos in-browser, normalize filenames, and view storage stats. Everything runs in the browser; there is **no backend**.

**Supported environments:** Chromium-based browsers with `showDirectoryPicker` / `FileSystemDirectoryHandle` (Chrome, Edge, etc.). Not Safari/Firefox for full functionality. Trim also relies on `FileSystemFileHandle.move`, cross-origin-isolated workers (multithreaded `@ffmpeg/core-mt`), and `showSaveFilePicker`.

## Stack

| Layer | Choice |
|--------|--------|
| UI | **Preact** 10 (`preact/hooks`, `preact/compat` for `memo`) |
| Build | **Vite** 8, **TypeScript** |
| Styling | **Tailwind CSS** v4 (`@tailwindcss/vite`), utility classes in JSX (`class=`) |
| Output | **Single-file** bundle (`vite-plugin-singlefile`) — inlined JS/CSS in `dist/index.html` |
| Video trim | **`@ffmpeg/ffmpeg`** + **`@ffmpeg/core-mt`** (CDN, version pinned in `video-trim-scope.ts`) + **`@ffmpeg/util`** |
| Tests | **Vitest** 4 (default `node`; component tests opt into `happy-dom` via `@vitest-environment` directive) + **`@testing-library/preact`** |

## Commands

```bash
npm install          # dependencies
npm run dev          # dev server (Vite)
npm run build        # tsc -b && vite build — must pass before finishing
npm run preview      # serve production build locally
npm test             # Vitest run (CI mode)
npm run test:watch   # Vitest watch
```

Run **`npm run build`** after substantive changes to ensure TypeScript and the bundle succeed.

## Repository layout

```
src/
  app.tsx              # Root: load/save folder handle, gate on tag index, DirectoryPicker vs FileBrowser
  main.tsx             # Entry
  fs-access.d.ts       # File System Access API ambient types
  components/
    DirectoryPicker.tsx          # Empty-state landing screen + folder pick
    FileBrowser.tsx              # Main shell: list/thumb views, search, sidebar tag filter, viewer pane, modal hosts
    FileRow.tsx                  # List-view row (file or directory) + FileListItem / DirListItem types
    FileThumbnail.tsx            # Thumbnail-view cell (image bitmap downscale, video poster fallback)
    Sidebar.tsx                  # Search box, media-kind filter, tag list with counts, breadcrumb
    PreviewModal.tsx             # Image / video preview, A–B loops, trim export, quick-add tag chips
    PreviewModal.test.tsx        # DOM render test (happy-dom)
    ViewerPane.tsx               # Right-side multi-cell pinned viewer; reuses useVideoABLoop for saved loops
    TagsModal.tsx                # Edit tags for one or many files (TagEditor host)
    TagEditor.tsx                # Tag chip editor + datalist autocomplete
    MoreTagsQuickAddDropdown.tsx # “More” submenu used by quick-add menus and pill rows
    NormalizeFilenamesModal.tsx  # Configure → run → report flow for bulk filename rewrite
    StorageStatsModal.tsx        # Storage breakdown by kind / extension / tag
    FileContextMenu.tsx          # Generic positioned context menu container
    ProgressBar.tsx              # Determinate / indeterminate bar (modals, scans)
  lib/
    tags.ts                # In-memory tag + video-loop store backed by `index.json`; debounced writes; legacy localStorage migration
    index-json.ts          # Pure parse/serialize for `index.json` (tags + `__degu.videoLoops`)
    patch-tag-index.ts     # Incremental inverted-index updates after a single-path tag edit
    root-tag-index.ts      # Full-tree walk + inverted index (currently used as fallback / future deep resync)
    tag-filter-paths.ts    # Pure: paths matching all tags, selectable-tag set, untagged set from inverted index
    files-matching-tags.ts # Walk-based fallback: files with required tags or fully untagged (when index map is stale)
    media-paths.ts         # Recursive enumeration of media paths under root (full + untagged variants)
    tag-key.ts             # Stack + name → path-relative-to-root storage key
    recent-tags.ts         # `localStorage` MRU of applied tags + visible-strip cap
    more-quick-add-tags.ts # Pure: build the “More” lists (single + multi selection) merging recent overflow with index tags
    supported-media.ts     # Whitelisted image / video extensions (GIF = image), MediaKindFilter helpers
    preview.ts             # filename → 'image' | 'video' | null
    recursive-scan.ts      # Name search walk: dirs + files matching a query, with progress + cancel
    resolve-path.ts        # Path string → FileSystemFileHandle / FileListItem (and parent + filename)
    resolve-directory-stack.ts # Path segments → directory handle stack (breadcrumb)
    hash-location.ts       # Hash ↔ path segments in the URL bar
    handle-store.ts        # IndexedDB persistence of the root directory handle
    throttle.ts            # throttleVoid / throttle / mapWithConcurrency
    format-bytes.ts        # Human-readable byte size
    format-media-time.ts   # Seconds → m:ss / h:mm:ss
    storage-stats.ts       # One walk → totalBytes, byKind, byExtension, byTag, untaggedBytes
    normalize-filenames.ts # Plan + execute bulk substring removal in basenames; rewrites tag keys; flushes index
    ffmpeg-trim.ts         # Lazy-load `@ffmpeg/core-mt` from CDN, run `-c copy` stream-copy trim
    video-trim-scope.ts    # FFmpeg core version pin + MAX_TRIM_INPUT_BYTES (~512 MiB)
    video-trim-estimate.ts # Heuristic kept-bytes / saved-bytes estimate for UI
    video-ab-loop.ts       # `useVideoABLoop` hook + VIDEO_AB_LOOP_EPS (used by PreviewModal + ViewerPane)
    save-trimmed-video.ts  # Write trimmed blob to sibling folder, else `showSaveFilePicker`
```

## Domain concepts

### Connected root

The user picks **one** folder (`rootHandle`). Paths used for tags and search are **relative to that folder** (e.g. `src/app.php`), joined with `/`.

### URL hash and navigation

The current folder under the connected root is reflected in the **location hash** (e.g. `#/photos/2024`). Opening a subfolder uses **`history.pushState`** so the **browser Back** button moves to the parent folder; breadcrumb jumps use **`replaceState`** so they do not add extra history entries. Picking a new root folder remounts `FileBrowser` and resets the hash to `#/`.

### Tag and video-loop storage (`src/lib/tags.ts` + `index-json.ts`)

- Tags live in **`index.json`** at the **connected root** — a JSON object mapping **`tagStorageKey`** (path relative to root, `/`-separated) → `string[]`.
- **Video preview loops** (A–B repeat segments) are stored under the reserved key **`__degu`** → `{ "videoLoops": { [tagStorageKey]: [{ id, startSec, endSec }, ...] } }`. The tag loader **ignores** non-`string[]` values, so this does not affect tag indexing. Avoid naming a file such that its `tagStorageKey` equals **`__degu`** (reserved-key collision).
- **`initTagIndex(rootHandle)`** runs before `FileBrowser`; **`readwrite`** folder permission is required to create/update the file.
- If **`index.json` is missing**, the app walks all media paths once and **imports** tags from legacy **`localStorage`** keys (`ftag_` + FNV-1a hex), then writes `index.json` when possible.
- Edits are **debounced** to disk; **`flushTagIndex`** runs on `pagehide` (persists both tags and video loops).
- **`getTagsCached`** dedupes reads within a single scan via a `Map<string, string[]>`.
- **`renameTagStorageKey` / `renameTagStorageKeysBatch`** move tag + loop entries when files are renamed (used by `normalize-filenames`).

### Sidebar vs tag filter performance

- After **`initTagIndex`**, **`buildAggregateFromTagIndex`** (in `tags.ts`) builds **`tagToPaths`** and counts from the loaded **`index.json`** map — **no filesystem walk** on reload.
- Single-path edits patch the inverted index in place via **`patchTagIndexAfterEdit`** (no rescan).
- **`aggregateTagsUnderRoot`** in `root-tag-index.ts` still walks the tree + reads tags per path; kept as fallback / deep-resync tooling.
- **Tag filter UI** uses the inverted index + **`pathsMatchingAllTags`** + **`resolvePathToFileListItem`**. **`findFilesWithAllTags`** / **`findUntaggedFiles`** in `files-matching-tags.ts` remain a tree-walk fallback.

### Video loops and trim

- Users save multiple **loops** per video (start/end times in seconds) from **`PreviewModal`**; **Play loop** constrains playback via **`useVideoABLoop`**. Same hook powers loops pinned to **`ViewerPane`**.
- **Trim export** (`-c copy` via `ffmpeg.wasm`, lazy-loaded from CDN) writes a sibling file in the source folder when possible, else falls back to **`showSaveFilePicker`**. Stream-copy snaps cuts to keyframes; size limit is **`MAX_TRIM_INPUT_BYTES`** (~512 MiB) to keep WASM memory bounded.

### Storage stats and filename normalization

- **`StorageStatsModal`** runs **`computeStorageStats`** (one tree walk) for byte totals broken down by kind, extension, tag, and untagged.
- **`NormalizeFilenamesModal`** drives **`runNormalizeFilenames`**: collect paths, plan substring removals, rename via `FileSystemFileHandle.move`, rewrite tag keys, flush `index.json`. Skips collisions and invalid (non-supported-extension) results.

### File list items

**`FileListItem`** includes **`tagStorageKey`** (required) for every file row so tags and UI stay consistent across list/thumbnail/search/tag-filter modes.

## Conventions for changes

1. **Match existing style:** Preact + hooks, Tailwind classes, no new UI framework.
2. **Keep diffs focused** on the task; avoid drive-by refactors or unrelated files.
3. **Do not add** markdown/docs files unless the user asks (this file and `README.md` are exceptions).
4. **File System Access** APIs are async; preserve cancellation patterns (`cancelled` flags in `useEffect`, `AbortSignal` for long scans/trim) where already used.
5. **Pure helpers go in `src/lib/`** with a sibling `*.test.ts`. Component tests use `@testing-library/preact` and a per-file `/** @vitest-environment happy-dom */` directive.
6. **Bumping the FFmpeg core version** requires changing `FFMPEG_CORE_MT_VERSION` in `video-trim-scope.ts` (which is also where the CDN URL in `ffmpeg-trim.ts` reads from).

## Testing

- **`npm test`** (Vitest, `src/**/*.test.ts` + `src/**/*.test.tsx`). Default environment is `node`; tests that render components opt into `happy-dom` via `/** @vitest-environment happy-dom */` at the top of the file.
- **Covered today** (pure helpers + one component): [`index-json`](src/lib/index-json.test.ts), [`tag-key`](src/lib/tag-key.test.ts), [`recent-tags`](src/lib/recent-tags.test.ts), [`supported-media`](src/lib/supported-media.test.ts), [`hash-location`](src/lib/hash-location.test.ts), [`throttle`](src/lib/throttle.test.ts), [`format-bytes`](src/lib/format-bytes.test.ts), [`storage-stats`](src/lib/storage-stats.test.ts), [`tag-filter-paths`](src/lib/tag-filter-paths.test.ts), [`more-quick-add-tags`](src/lib/more-quick-add-tags.test.ts), [`patch-tag-index`](src/lib/patch-tag-index.test.ts), [`video-trim-estimate`](src/lib/video-trim-estimate.test.ts), [`video-trim-scope`](src/lib/video-trim-scope.test.ts), [`save-trimmed-video`](src/lib/save-trimmed-video.test.ts), [`PreviewModal`](src/components/PreviewModal.test.tsx).
- **`npm run build`** must still pass after changes; there is no automated browser/e2e suite.

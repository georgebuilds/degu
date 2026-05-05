# degu

A local-first media browser that runs entirely in your browser. Pick a folder on disk, then browse, search, tag, preview, A–B-loop, trim, and rename media files without uploading anything.

There is no backend. degu builds to a single self-contained `index.html`.

## Features

- **Browse** any local folder with list and thumbnail views, breadcrumb navigation, and URL-hash routing (browser Back works).
- **Tag** images and videos. Tags are stored in `index.json` at the connected root; quick-add chips, a “More” submenu, and bulk multi-select editing are built in.
- **Preview** images and videos in a modal (keyboard-navigable, with sibling navigation).
- **A–B loops** for videos: save multiple loop ranges per file and pin them to a side-by-side viewer pane.
- **Trim videos** in-browser with `ffmpeg.wasm` (`-c copy`, fast, keyframe-snapped). Output saves to a sibling file or via Save As.
- **Normalize filenames** in bulk by removing substrings; tag entries follow the rename.
- **Storage stats**: byte totals broken down by kind, extension, and tag.
- **Search** filenames recursively under the current folder.

## Browser support

degu uses the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_Access_API) (`showDirectoryPicker`, `FileSystemDirectoryHandle`, `FileSystemFileHandle.move`, `showSaveFilePicker`) and multithreaded `@ffmpeg/core-mt` (which requires cross-origin isolation).

**Chromium-based browsers only** (Chrome, Edge, Brave, Arc, etc.). Safari and Firefox do not implement the required APIs.

The folder handle is persisted in IndexedDB; reloads prompt for a single click to re-grant `readwrite` permission.

## Output

`npm run build` produces `dist/index.html` with all JS and CSS inlined (`vite-plugin-singlefile`). You can host it on any static server, open it directly from disk in a Chromium browser that allows it, or drop it next to your media library.

The `@ffmpeg/core-mt` WASM core is loaded lazily from a CDN the first time you trim a video.

## Development

```bash
npm install
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build → dist/index.html
npm run preview      # serve the built bundle
npm test             # Vitest (run mode)
npm run test:watch
```

Tech: Preact 10, TypeScript, Vite 8, Tailwind CSS v4, Vitest 4 (`@testing-library/preact` + `happy-dom` for component tests), `@ffmpeg/ffmpeg` + `@ffmpeg/core-mt` + `@ffmpeg/util` for video trim.

## Where things live

- `src/app.tsx` — root, folder handle, tag-index init.
- `src/components/` — UI: `FileBrowser`, modals, viewer, sidebar, rows.
- `src/lib/` — pure helpers and File System Access I/O (tags, trim, stats, scans, formatting). Each pure module ships with a sibling `*.test.ts`.

## For AI agent contributors

See [`agents.md`](agents.md) for the architecture map, conventions, and testing notes.

## Contributing

Issues and PRs welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, code style, and the DCO sign-off workflow, and [`agents.md`](agents.md) for architecture. Security reports go to degu.barstool750 [at] passmail [dot] net (replace [at] with @ and [dot] with .) — see [`SECURITY.md`](SECURITY.md).

## License

degu is licensed under **AGPL-3.0-or-later** ([`LICENSE`](LICENSE)). Because AGPL extends copyleft to network use, anyone who runs a modified version of degu as a network/SaaS service must offer the corresponding source to its users; for personal local-only use the practical effect is the same as GPL.

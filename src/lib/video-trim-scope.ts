/**
 * Product scope for in-browser trim (ffmpeg.wasm).
 *
 * - **New file only:** export writes a new file (Save As / sibling); we do not replace or delete the source.
 * - **Stream copy:** `-c copy` for speed; cuts align to keyframes (may differ slightly from loop bounds).
 * - **Size limit:** refuse inputs larger than this to reduce OOM risk in WASM.
 */

/** Must match the @ffmpeg/core-mt version pinned in `ffmpeg-trim.ts` (CDN URL). */
export const FFMPEG_CORE_MT_VERSION = '0.12.10'

/** ~512 MiB — ffmpeg holds a copy in MEMFS; keep a conservative cap. */
export const MAX_TRIM_INPUT_BYTES = 512 * 1024 * 1024

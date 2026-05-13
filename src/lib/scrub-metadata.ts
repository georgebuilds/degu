import {
  MAX_SCRUB_INPUT_BYTES,
  scrubFileWithFFmpeg,
  type ScrubAction,
  type MetadataField,
} from './ffmpeg-scrub'
import { collectAllMediaRelativePaths } from './media-paths'
import {
  basenameFromRelativePath,
  fileExtension,
  isSupportedImageFile,
  isSupportedVideoFile,
} from './supported-media'

export type { MetadataField, ScrubAction }

export type ScrubProgress = {
  phase: 'collect' | 'run'
  done: number
  total: number
  currentPath?: string
}

export type ScrubFailure = { path: string; message: string }

export type ScrubReport = {
  scrubbed: number
  skippedUnsupported: number
  skippedTooLarge: number
  skippedModifyImage: number
  failed: ScrubFailure[]
  successfulScrubs: { path: string }[]
}

/**
 * Targets we'll attempt to scrub. SVG is on the supported-media list but it's
 * XML, not a container ffmpeg can stream-copy, so we exclude it here. AVIF is
 * included but may fail with older ffmpeg cores — surfaced as a per-file
 * `failed` entry rather than an upfront skip.
 */
const SCRUBBABLE_EXTS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'mp4',
  'm4v',
  'webm',
  'mov',
  'mkv',
  'avi',
])

export function isScrubbable(filename: string): boolean {
  return SCRUBBABLE_EXTS.has(fileExtension(filename))
}

/**
 * v1 modify is video-only. Stream-copy with `-metadata key=value` works
 * cleanly for video containers (MP4 atoms, Matroska/WebM tags). Image EXIF
 * needs a real EXIF writer (piexifjs for JPEG, custom chunk code for PNG/WebP)
 * which would double the surface area; deferred to a follow-up.
 */
export function canModifyMetadata(filename: string): boolean {
  return isSupportedVideoFile(filename)
}

/**
 * Well-known video metadata fields the UI exposes in a dropdown. ffmpeg
 * normalises these across MP4/MOV/MKV/WebM into the closest container atom.
 */
export const MODIFIABLE_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'date', label: 'Date' },
  { key: 'comment', label: 'Comment' },
  { key: 'copyright', label: 'Copyright' },
  { key: 'genre', label: 'Genre' },
  { key: 'description', label: 'Description' },
]

export type ScrubTarget =
  | { kind: 'allMedia' }
  | { kind: 'paths'; paths: string[] }

export type RunScrubOptions = {
  signal?: AbortSignal
  onProgress?: (p: ScrubProgress) => void
}

async function getFileHandleForPath(
  root: FileSystemDirectoryHandle,
  relativePath: string
): Promise<FileSystemFileHandle> {
  const parts = relativePath.split('/').filter(Boolean)
  if (parts.length === 0) throw new Error('Empty path')
  let dir: FileSystemDirectoryHandle = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!)
  }
  return dir.getFileHandle(parts[parts.length - 1]!)
}

/**
 * Strip or modify metadata for every path in `target`. ffmpeg runs locally
 * (wasm); output bytes overwrite the source via the same writable contract
 * trim uses. Both FSA and HTTP drivers handle the close-time atomic rename.
 */
export async function runScrubMetadata(
  root: FileSystemDirectoryHandle,
  target: ScrubTarget,
  action: ScrubAction,
  options?: RunScrubOptions
): Promise<ScrubReport> {
  const signal = options?.signal
  const onProgress = options?.onProgress

  let paths: string[]
  if (target.kind === 'allMedia') {
    let collectDone = 0
    paths = await collectAllMediaRelativePaths(root, {
      emitCollect: () => {
        collectDone++
        onProgress?.({ phase: 'collect', done: collectDone, total: 0 })
      },
    })
  } else {
    paths = [...target.paths]
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  paths.sort((a, b) => a.localeCompare(b))

  const failed: ScrubFailure[] = []
  const successfulScrubs: { path: string }[] = []
  let scrubbed = 0
  let skippedUnsupported = 0
  let skippedTooLarge = 0
  let skippedModifyImage = 0

  const total = paths.length
  onProgress?.({ phase: 'run', done: 0, total })

  for (let i = 0; i < paths.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const path = paths[i]!
    const base = basenameFromRelativePath(path)

    onProgress?.({ phase: 'run', done: i, total, currentPath: path })

    if (!isScrubbable(base)) {
      skippedUnsupported++
      continue
    }

    if (action.mode === 'modify' && isSupportedImageFile(base)) {
      skippedModifyImage++
      continue
    }

    try {
      const fh = await getFileHandleForPath(root, path)
      const file = await fh.getFile()

      if (file.size > MAX_SCRUB_INPUT_BYTES) {
        skippedTooLarge++
        continue
      }

      const data = await scrubFileWithFFmpeg({ file, action, signal })

      const writable = await fh.createWritable()
      try {
        // Re-wrap: ffmpeg.wasm returns Uint8Array<ArrayBufferLike> backed by
        // SharedArrayBuffer; FSA write() and Blob() want a plain ArrayBuffer.
        await writable.write(new Blob([new Uint8Array(data)]))
      } finally {
        await writable.close()
      }

      successfulScrubs.push({ path })
      scrubbed++
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      const message = e instanceof Error ? e.message : String(e)
      failed.push({ path, message })
    }
  }

  onProgress?.({ phase: 'run', done: total, total })

  return {
    scrubbed,
    skippedUnsupported,
    skippedTooLarge,
    skippedModifyImage,
    failed,
    successfulScrubs,
  }
}

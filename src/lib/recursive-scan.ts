import { tagStorageKeyFromRootAndPathUnderCurrentDir } from './tag-key'
import { getTagsCached } from './tags'
import { isSupportedMediaFile } from './supported-media'
import { mapWithConcurrency, throttleVoid } from './throttle'

const SUBDIR_CONCURRENCY = 8

export type RecursiveFile = {
  kind: 'file'
  name: string
  handle: FileSystemFileHandle
  size: number
  lastModified: number
  relativePath: string
  /** Same as path relative to connected root; used for tag storage. */
  tagStorageKey: string
}

export type RecursiveDir = {
  kind: 'directory'
  name: string
  handle: FileSystemDirectoryHandle
  relativePath: string
}

export type RecursiveScanResult = {
  dirs: RecursiveDir[]
  files: RecursiveFile[]
  /** Keyed by tag storage path (relative to connected root). */
  fileTags: Record<string, string[]>
}

export type SearchScanProgress = {
  entriesVisited: number
  dirsSeen: number
}

export type ScanRecursiveOptions = {
  signal?: AbortSignal
  onProgress?: (p: SearchScanProgress) => void
  /**
   * Path prefix already walked from the connected root to `dir`. Used to label
   * results as `"<startSubpath>/<rel>"` so callers that scan a subdirectory
   * still produce paths relative to the root.
   */
  startSubpath?: string
}

type WalkFile = Omit<RecursiveFile, 'tagStorageKey'>

function abortIfNeeded(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Search cancelled', 'AbortError')
  }
}

async function walk(
  dir: FileSystemDirectoryHandle,
  relPrefix: string,
  matches: (basename: string) => boolean,
  signal: AbortSignal | undefined,
  progress: { entries: number; dirs: number } | undefined,
  emitProgress: (() => void) | undefined
): Promise<{ dirs: RecursiveDir[]; files: WalkFile[] }> {
  abortIfNeeded(signal)
  const dirs: RecursiveDir[] = []
  const files: WalkFile[] = []
  const subdirs: { dh: FileSystemDirectoryHandle; rel: string }[] = []
  const pendingFiles: {
    rel: string
    name: string
    fh: FileSystemFileHandle
  }[] = []

  for await (const entry of dir.values()) {
    abortIfNeeded(signal)
    if (progress) {
      progress.entries++
      if (entry.kind === 'directory') progress.dirs++
      emitProgress?.()
    }
    const rel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`
    if (entry.kind === 'file') {
      if (matches(entry.name) && isSupportedMediaFile(entry.name)) {
        pendingFiles.push({
          rel,
          name: entry.name,
          fh: entry as FileSystemFileHandle,
        })
      }
    } else {
      const dh = entry as FileSystemDirectoryHandle
      subdirs.push({ dh, rel })
      if (matches(entry.name)) {
        dirs.push({
          kind: 'directory',
          name: entry.name,
          handle: dh,
          relativePath: rel,
        })
      }
    }
  }

  abortIfNeeded(signal)
  const nestedResults = await mapWithConcurrency(
    subdirs,
    ({ dh, rel }) => walk(dh, rel, matches, signal, progress, emitProgress),
    SUBDIR_CONCURRENCY
  )
  for (const nested of nestedResults) {
    files.push(...nested.files)
    dirs.push(...nested.dirs)
  }

  if (pendingFiles.length > 0) {
    const built = await Promise.all(
      pendingFiles.map(async ({ rel, name, fh }) => {
        const file = await fh.getFile()
        return {
          kind: 'file' as const,
          name,
          handle: fh,
          size: file.size,
          lastModified: file.lastModified,
          relativePath: rel,
        }
      })
    )
    files.push(...built)
  }

  return { dirs, files }
}

/**
 * Recursively lists files and folders under `root` whose basename contains `query` (case-insensitive).
 * `stack` must be the breadcrumb from connected root so tag paths match storage keys.
 */
export async function scanRecursive(
  root: FileSystemDirectoryHandle,
  query: string,
  stack: FileSystemDirectoryHandle[],
  options?: ScanRecursiveOptions
): Promise<RecursiveScanResult> {
  const q = query.trim().toLowerCase()
  if (q === '') {
    return { dirs: [], files: [], fileTags: {} }
  }

  const signal = options?.signal
  const onProgress = options?.onProgress
  const progress = onProgress ? { entries: 0, dirs: 0 } : undefined
  const emitProgress = onProgress
    ? throttleVoid(() => {
        onProgress({
          entriesVisited: progress!.entries,
          dirsSeen: progress!.dirs,
        })
      }, 120)
    : undefined

  const matches = (basename: string) => basename.toLowerCase().includes(q)
  const startSubpath = (options?.startSubpath ?? '').replace(/^\/+|\/+$/g, '')
  const { dirs, files: rawFiles } = await walk(
    root,
    startSubpath,
    matches,
    signal,
    progress,
    emitProgress
  )
  if (progress && onProgress) {
    onProgress({
      entriesVisited: progress.entries,
      dirsSeen: progress.dirs,
    })
  }

  dirs.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  rawFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  const files: RecursiveFile[] = rawFiles.map(f => ({
    ...f,
    tagStorageKey: tagStorageKeyFromRootAndPathUnderCurrentDir(
      stack,
      f.relativePath
    ),
  }))

  const tagCache = new Map<string, string[]>()
  const tagSets = files.map(f => getTagsCached(f.tagStorageKey, tagCache))
  const fileTags: Record<string, string[]> = {}
  files.forEach((f, i) => {
    fileTags[f.tagStorageKey] = tagSets[i] ?? []
  })

  return { dirs, files, fileTags }
}

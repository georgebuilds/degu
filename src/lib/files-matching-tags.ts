import { getTagsCached } from './tags'
import { isSupportedMediaFile } from './supported-media'
import { mapWithConcurrency } from './throttle'

const SUBDIR_CONCURRENCY = 8

export type TaggedFileEntry = {
  kind: 'file'
  name: string
  handle: FileSystemFileHandle
  size: number
  lastModified: number
  relativePath: string
  /** Path from connected root; tag storage key (same as relativePath here). */
  tagStorageKey: string
}

function abortIfNeeded(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Search cancelled', 'AbortError')
  }
}

async function walk(
  dir: FileSystemDirectoryHandle,
  relPrefix: string,
  requiredTags: string[],
  tagCache: Map<string, string[]>,
  signal: AbortSignal | undefined
): Promise<TaggedFileEntry[]> {
  abortIfNeeded(signal)
  const out: TaggedFileEntry[] = []
  const subdirs: { dh: FileSystemDirectoryHandle; rel: string }[] = []
  const pendingFiles: {
    rel: string
    name: string
    fh: FileSystemFileHandle
  }[] = []

  for await (const entry of dir.values()) {
    abortIfNeeded(signal)
    const rel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`
    if (entry.kind === 'file') {
      if (!isSupportedMediaFile(entry.name)) continue
      const tags = getTagsCached(rel, tagCache)
      const tagSet = new Set(tags)
      if (requiredTags.every(t => tagSet.has(t))) {
        pendingFiles.push({
          rel,
          name: entry.name,
          fh: entry as FileSystemFileHandle,
        })
      }
    } else {
      subdirs.push({ dh: entry as FileSystemDirectoryHandle, rel })
    }
  }

  abortIfNeeded(signal)
  const nestedResults = await mapWithConcurrency(
    subdirs,
    ({ dh, rel }) => walk(dh, rel, requiredTags, tagCache, signal),
    SUBDIR_CONCURRENCY
  )
  for (const arr of nestedResults) {
    out.push(...arr)
  }

  if (pendingFiles.length > 0) {
    abortIfNeeded(signal)
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
          tagStorageKey: rel,
        }
      })
    )
    out.push(...built)
  }

  return out
}

async function walkUntagged(
  dir: FileSystemDirectoryHandle,
  relPrefix: string,
  tagCache: Map<string, string[]>,
  signal: AbortSignal | undefined
): Promise<TaggedFileEntry[]> {
  abortIfNeeded(signal)
  const out: TaggedFileEntry[] = []
  const subdirs: { dh: FileSystemDirectoryHandle; rel: string }[] = []
  const pendingFiles: {
    rel: string
    name: string
    fh: FileSystemFileHandle
  }[] = []

  for await (const entry of dir.values()) {
    abortIfNeeded(signal)
    const rel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`
    if (entry.kind === 'file') {
      if (!isSupportedMediaFile(entry.name)) continue
      const tags = getTagsCached(rel, tagCache)
      if (tags.length === 0) {
        pendingFiles.push({
          rel,
          name: entry.name,
          fh: entry as FileSystemFileHandle,
        })
      }
    } else {
      subdirs.push({ dh: entry as FileSystemDirectoryHandle, rel })
    }
  }

  abortIfNeeded(signal)
  const nestedResults = await mapWithConcurrency(
    subdirs,
    ({ dh, rel }) => walkUntagged(dh, rel, tagCache, signal),
    SUBDIR_CONCURRENCY
  )
  for (const arr of nestedResults) {
    out.push(...arr)
  }

  if (pendingFiles.length > 0) {
    abortIfNeeded(signal)
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
          tagStorageKey: rel,
        }
      })
    )
    out.push(...built)
  }

  return out
}

/**
 * All media files under `root` with no tags (empty tag list in the index).
 */
export async function findUntaggedFiles(
  root: FileSystemDirectoryHandle,
  signal?: AbortSignal
): Promise<{
  files: TaggedFileEntry[]
  fileTags: Record<string, string[]>
}> {
  const tagCache = new Map<string, string[]>()
  const files = await walkUntagged(root, '', tagCache, signal)
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const fileTags: Record<string, string[]> = {}
  for (const f of files) {
    fileTags[f.tagStorageKey] = []
  }
  return { files, fileTags }
}

/**
 * All files under `root` whose stored tags include every tag in `requiredTags`.
 */
export async function findFilesWithAllTags(
  root: FileSystemDirectoryHandle,
  requiredTags: string[],
  signal?: AbortSignal
): Promise<{
  files: TaggedFileEntry[]
  fileTags: Record<string, string[]>
}> {
  if (requiredTags.length === 0) {
    return { files: [], fileTags: {} }
  }
  const tagCache = new Map<string, string[]>()
  const files = await walk(root, '', requiredTags, tagCache, signal)
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const fileTags: Record<string, string[]> = {}
  for (const f of files) {
    fileTags[f.tagStorageKey] = tagCache.get(f.tagStorageKey) ?? []
  }
  return { files, fileTags }
}

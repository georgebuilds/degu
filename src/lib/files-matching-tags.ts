import { getTagsCached } from './tags'
import { isSupportedMediaFile } from './supported-media'

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

async function walk(
  dir: FileSystemDirectoryHandle,
  relPrefix: string,
  requiredTags: string[],
  tagCache: Map<string, string[]>
): Promise<TaggedFileEntry[]> {
  const out: TaggedFileEntry[] = []
  const subdirPromises: Promise<TaggedFileEntry[]>[] = []
  const pendingFiles: {
    rel: string
    name: string
    fh: FileSystemFileHandle
  }[] = []

  for await (const entry of dir.values()) {
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
      subdirPromises.push(
        walk(entry as FileSystemDirectoryHandle, rel, requiredTags, tagCache)
      )
    }
  }

  const nestedResults = await Promise.all(subdirPromises)
  for (const arr of nestedResults) {
    out.push(...arr)
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
  tagCache: Map<string, string[]>
): Promise<TaggedFileEntry[]> {
  const out: TaggedFileEntry[] = []
  const subdirPromises: Promise<TaggedFileEntry[]>[] = []
  const pendingFiles: {
    rel: string
    name: string
    fh: FileSystemFileHandle
  }[] = []

  for await (const entry of dir.values()) {
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
      subdirPromises.push(
        walkUntagged(entry as FileSystemDirectoryHandle, rel, tagCache)
      )
    }
  }

  const nestedResults = await Promise.all(subdirPromises)
  for (const arr of nestedResults) {
    out.push(...arr)
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
  root: FileSystemDirectoryHandle
): Promise<{
  files: TaggedFileEntry[]
  fileTags: Record<string, string[]>
}> {
  const tagCache = new Map<string, string[]>()
  const files = await walkUntagged(root, '', tagCache)
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
  requiredTags: string[]
): Promise<{
  files: TaggedFileEntry[]
  fileTags: Record<string, string[]>
}> {
  if (requiredTags.length === 0) {
    return { files: [], fileTags: {} }
  }
  const tagCache = new Map<string, string[]>()
  const files = await walk(root, '', requiredTags, tagCache)
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const fileTags: Record<string, string[]> = {}
  for (const f of files) {
    fileTags[f.tagStorageKey] = tagCache.get(f.tagStorageKey) ?? []
  }
  return { files, fileTags }
}

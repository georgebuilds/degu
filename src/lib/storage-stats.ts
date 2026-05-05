import { getTagsCached } from './tags'
import {
  fileExtension,
  isSupportedImageFile,
  isSupportedVideoFile,
} from './supported-media'

export type StorageStatsProgress = {
  filesScanned: number
  dirsVisited: number
  bytesSoFar: number
}

export type StorageStatsReport = {
  totalBytes: number
  fileCount: number
  byKind: { image: number; video: number; other: number }
  /** File extensions (lowercase), sorted by bytes descending. */
  byExtension: { ext: string; bytes: number }[]
  /** Tags from index, sorted by bytes descending. */
  byTag: { tag: string; bytes: number }[]
  /** Bytes in files with no tags (per index). */
  untaggedBytes: number
}

export type ComputeStorageStatsOptions = {
  onProgress?: (p: StorageStatsProgress) => void
  /** Call every N files to limit UI churn (default 24). */
  progressEvery?: number
}

/** Sort map entries by numeric value descending. */
export function sortBytesMapDescending(m: Map<string, number>): {
  key: string
  bytes: number
}[] {
  return [...m.entries()]
    .map(([key, bytes]) => ({ key, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
}

/**
 * Recursively measure every file under `root`, aggregate by kind, extension,
 * and tag (from the loaded tag index). Folders themselves do not use space in this model.
 */
export async function computeStorageStats(
  root: FileSystemDirectoryHandle,
  options?: ComputeStorageStatsOptions
): Promise<StorageStatsReport> {
  const onProgress = options?.onProgress
  const every = options?.progressEvery ?? 24

  let totalBytes = 0
  let fileCount = 0
  let dirsVisited = 0
  const byKind = { image: 0, video: 0, other: 0 }
  const byExt = new Map<string, number>()
  const byTag = new Map<string, number>()
  let untaggedBytes = 0
  const tagCache = new Map<string, string[]>()

  const emit = () => {
    onProgress?.({
      filesScanned: fileCount,
      dirsVisited,
      bytesSoFar: totalBytes,
    })
  }

  async function walk(
    dir: FileSystemDirectoryHandle,
    relPrefix: string
  ): Promise<void> {
    const entries: { name: string; kind: string; handle: unknown }[] = []
    for await (const entry of dir.values()) {
      entries.push({
        name: entry.name,
        kind: entry.kind,
        handle: entry,
      })
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      const rel =
        relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`
      if (entry.kind === 'file') {
        const fh = entry.handle as FileSystemFileHandle
        let size = 0
        try {
          const file = await fh.getFile()
          size = file.size
        } catch {
          continue
        }
        totalBytes += size
        fileCount += 1
        const name = entry.name
        if (isSupportedImageFile(name)) {
          byKind.image += size
        } else if (isSupportedVideoFile(name)) {
          byKind.video += size
        } else {
          byKind.other += size
        }
        const extRaw = fileExtension(name)
        const extLabel = extRaw === '' ? '(no extension)' : `.${extRaw}`
        byExt.set(extLabel, (byExt.get(extLabel) ?? 0) + size)

        const tags = getTagsCached(rel, tagCache)
        if (tags.length === 0) {
          untaggedBytes += size
        } else {
          for (const t of tags) {
            const u = t.trim()
            if (!u) continue
            byTag.set(u, (byTag.get(u) ?? 0) + size)
          }
        }

        if (fileCount % every === 0) emit()
      } else {
        dirsVisited += 1
        await walk(entry.handle as FileSystemDirectoryHandle, rel)
      }
    }
  }

  await walk(root, '')
  emit()

  const extSorted = sortBytesMapDescending(byExt).map(({ key, bytes }) => ({
    ext: key,
    bytes,
  }))
  const tagSorted = sortBytesMapDescending(byTag).map(({ key, bytes }) => ({
    tag: key,
    bytes,
  }))

  return {
    totalBytes,
    fileCount,
    byKind,
    byExtension: extSorted,
    byTag: tagSorted,
    untaggedBytes,
  }
}

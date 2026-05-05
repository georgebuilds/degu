import { isSupportedMediaFile } from './supported-media'

export type CollectPathsStats = { mediaFiles: number; dirsVisited: number }

/**
 * All media file paths relative to `root` (e.g. `photos/a.jpg`).
 * Used by root tag aggregation and one-time tag migration.
 */
export async function collectAllMediaRelativePaths(
  root: FileSystemDirectoryHandle,
  options?: {
    stats?: CollectPathsStats
    emitCollect?: () => void
  }
): Promise<string[]> {
  const stats = options?.stats
  const emitCollect = options?.emitCollect
  return collectFromDir(root, '', stats, emitCollect)
}

async function collectFromDir(
  dir: FileSystemDirectoryHandle,
  relPrefix: string,
  stats: CollectPathsStats | undefined,
  emitCollect: (() => void) | undefined
): Promise<string[]> {
  if (stats) {
    stats.dirsVisited++
    emitCollect?.()
  }

  const filesHere: string[] = []
  const subdirHandles: { handle: FileSystemDirectoryHandle; rel: string }[] = []

  for await (const entry of dir.values()) {
    const rel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`
    if (entry.kind === 'file') {
      if (isSupportedMediaFile(entry.name)) {
        filesHere.push(rel)
        if (stats) {
          stats.mediaFiles++
          emitCollect?.()
        }
      }
    } else {
      subdirHandles.push({
        handle: entry as FileSystemDirectoryHandle,
        rel,
      })
    }
  }

  const nestedArrays = await Promise.all(
    subdirHandles.map(({ handle, rel }) =>
      collectFromDir(handle, rel, stats, emitCollect)
    )
  )
  let total = filesHere.length
  for (const arr of nestedArrays) total += arr.length
  const out: string[] = new Array(total)
  let idx = 0
  for (let i = 0; i < filesHere.length; i++) out[idx++] = filesHere[i]!
  for (const arr of nestedArrays) {
    for (let i = 0; i < arr.length; i++) out[idx++] = arr[i]!
  }
  return out
}

/**
 * One tree walk: media paths under `root` that are not in `taggedUnion`
 * (typically paths that already have at least one tag). Sorted like
 * {@link relativePathsUntagged} in tag-filter-paths.
 */
export async function collectUntaggedMediaRelativePaths(
  root: FileSystemDirectoryHandle,
  taggedUnion: ReadonlySet<string>,
  options?: {
    stats?: CollectPathsStats
    emitCollect?: () => void
  }
): Promise<string[]> {
  const stats = options?.stats
  const emitCollect = options?.emitCollect
  const raw = await collectUntaggedFromDir(root, '', taggedUnion, stats, emitCollect)
  raw.sort((a, b) => a.localeCompare(b))
  return raw
}

async function collectUntaggedFromDir(
  dir: FileSystemDirectoryHandle,
  relPrefix: string,
  taggedUnion: ReadonlySet<string>,
  stats: CollectPathsStats | undefined,
  emitCollect: (() => void) | undefined
): Promise<string[]> {
  if (stats) {
    stats.dirsVisited++
    emitCollect?.()
  }

  const filesHere: string[] = []
  const subdirHandles: { handle: FileSystemDirectoryHandle; rel: string }[] = []

  for await (const entry of dir.values()) {
    const rel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`
    if (entry.kind === 'file') {
      if (isSupportedMediaFile(entry.name) && !taggedUnion.has(rel)) {
        filesHere.push(rel)
        if (stats) {
          stats.mediaFiles++
          emitCollect?.()
        }
      }
    } else {
      subdirHandles.push({
        handle: entry as FileSystemDirectoryHandle,
        rel,
      })
    }
  }

  const nestedArrays = await Promise.all(
    subdirHandles.map(({ handle, rel }) =>
      collectUntaggedFromDir(handle, rel, taggedUnion, stats, emitCollect)
    )
  )
  let total = filesHere.length
  for (const arr of nestedArrays) total += arr.length
  const out: string[] = new Array(total)
  let idx = 0
  for (let i = 0; i < filesHere.length; i++) out[idx++] = filesHere[i]!
  for (const arr of nestedArrays) {
    for (let i = 0; i < arr.length; i++) out[idx++] = arr[i]!
  }
  return out
}

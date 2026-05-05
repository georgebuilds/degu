import { collectAllMediaRelativePaths } from './media-paths'
import { getTagsCached } from './tags'
import { throttleVoid } from './throttle'

export type RootTagCount = { tag: string; count: number }

export type AggregateTagsResult = {
  counts: RootTagCount[]
  /** For each tag name, set of file paths (relative to root) that have it. */
  tagToPaths: Map<string, Set<string>>
}

export type AggregateTagsProgress =
  | { phase: 'collect'; mediaFiles: number; dirsVisited: number }
  | { phase: 'tags'; done: number; total: number }

export type AggregateTagsOptions = {
  onProgress?: (p: AggregateTagsProgress) => void
}

/**
 * All tags applied under `root`, with counts and an inverted index for fast
 * tag filtering (paths per tag) without rescanning the tree.
 */
export async function aggregateTagsUnderRoot(
  root: FileSystemDirectoryHandle,
  options?: AggregateTagsOptions
): Promise<AggregateTagsResult> {
  const onProgress = options?.onProgress
  const stats = { mediaFiles: 0, dirsVisited: 0 }
  const emitCollect = onProgress
    ? throttleVoid(() => {
        onProgress({
          phase: 'collect',
          mediaFiles: stats.mediaFiles,
          dirsVisited: stats.dirsVisited,
        })
      }, 120)
    : undefined

  const paths = await collectAllMediaRelativePaths(root, {
    stats,
    emitCollect,
  })
  if (onProgress) {
    onProgress({
      phase: 'collect',
      mediaFiles: stats.mediaFiles,
      dirsVisited: stats.dirsVisited,
    })
  }

  const tagCache = new Map<string, string[]>()
  const tagToPaths = new Map<string, Set<string>>()
  const totalPaths = paths.length

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]!
    const tags = getTagsCached(path, tagCache)
    for (const t of tags) {
      let set = tagToPaths.get(t)
      if (!set) {
        set = new Set()
        tagToPaths.set(t, set)
      }
      set.add(path)
    }
    if (onProgress && totalPaths > 0) {
      const done = i + 1
      if (done % 64 === 0 || done === totalPaths) {
        onProgress({ phase: 'tags', done, total: totalPaths })
      }
    }
  }

  const counts = [...tagToPaths.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tag, pathSet]) => ({ tag, count: pathSet.size }))

  return { counts, tagToPaths }
}

function setsIntersect(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a]
  for (const x of smaller) {
    if (larger.has(x)) return true
  }
  return false
}

/**
 * Tags that stay enabled in the sidebar while `filterTags` is non-empty.
 * Always includes every tag in `filterTags` (so filters can be toggled off).
 * Includes any other tag that appears on at least one file that has all tags
 * in `filterTags` (so only co-occurring tags can narrow further).
 */
export function tagsSelectableWithFilter(
  tagToPaths: Map<string, Set<string>>,
  filterTags: string[],
  allTagsInSidebar: readonly string[]
): Set<string> {
  const out = new Set<string>()
  if (filterTags.length === 0) {
    for (const t of allTagsInSidebar) out.add(t)
    return out
  }
  for (const t of filterTags) {
    out.add(t)
  }
  const corpusPaths = pathsMatchingAllTags(tagToPaths, filterTags)
  const corpus = new Set(corpusPaths)
  for (const tag of allTagsInSidebar) {
    if (out.has(tag)) continue
    const paths = tagToPaths.get(tag)
    if (paths && setsIntersect(paths, corpus)) {
      out.add(tag)
    }
  }
  return out
}

/**
 * Paths (relative to root) of files that have every tag in `filterTags`,
 * using the inverted index from {@link aggregateTagsUnderRoot}.
 *
 * Sorts tag sets by size so the smallest drives the iteration, and
 * intersects in-place to avoid intermediate array/Set allocations.
 */
export function pathsMatchingAllTags(
  tagToPaths: Map<string, Set<string>>,
  filterTags: string[]
): string[] {
  if (filterTags.length === 0) return []

  const sets: Set<string>[] = []
  for (const tag of filterTags) {
    const s = tagToPaths.get(tag)
    if (!s || s.size === 0) return []
    sets.push(s)
  }
  sets.sort((a, b) => a.size - b.size)

  const result: string[] = []
  outer: for (const path of sets[0]!) {
    for (let i = 1; i < sets.length; i++) {
      if (!sets[i]!.has(path)) continue outer
    }
    result.push(path)
  }
  result.sort((a, b) => a.localeCompare(b))
  return result
}

/** Every path that appears under at least one tag in the inverted index. */
export function unionOfTaggedPaths(
  tagToPaths: Map<string, Set<string>>
): Set<string> {
  const out = new Set<string>()
  for (const paths of tagToPaths.values()) {
    for (const p of paths) out.add(p)
  }
  return out
}

/**
 * Paths in `allMediaPaths` that have no tags (not in `unionOfTaggedPaths`).
 * `allMediaPaths` is typically from {@link collectAllMediaRelativePaths}.
 */
export function relativePathsUntagged(
  taggedUnion: Set<string>,
  allMediaPaths: readonly string[]
): string[] {
  const out: string[] = []
  for (const p of allMediaPaths) {
    if (!taggedUnion.has(p)) out.push(p)
  }
  out.sort((a, b) => a.localeCompare(b))
  return out
}

import type { RootTagCount } from './root-tag-index'

/**
 * Updates the inverted index after tags change for a single path (no tree walk).
 */
export function patchTagIndexAfterEdit(
  tagToPaths: Map<string, Set<string>>,
  path: string,
  previousTags: string[],
  nextTags: string[]
): Map<string, Set<string>> {
  const prev = new Set(previousTags)
  const next = new Set(nextTags)
  for (const t of prev) {
    if (!next.has(t)) {
      const set = tagToPaths.get(t)
      if (set) {
        set.delete(path)
        if (set.size === 0) tagToPaths.delete(t)
      }
    }
  }
  for (const t of next) {
    if (!prev.has(t)) {
      let set = tagToPaths.get(t)
      if (!set) {
        set = new Set()
        tagToPaths.set(t, set)
      }
      set.add(path)
    }
  }
  return tagToPaths
}

export function countsFromTagToPaths(
  tagToPaths: Map<string, Set<string>>
): RootTagCount[] {
  return [...tagToPaths.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tag, pathSet]) => ({ tag, count: pathSet.size }))
}

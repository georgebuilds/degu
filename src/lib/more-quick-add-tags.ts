function sortTagNamesAsc(tags: string[]): string[] {
  return tags.slice().sort((a, b) => a.localeCompare(b))
}

/**
 * Tags from the index that are not on the file(s), excluding tags already shown
 * in the **visible** recent strip (first `n` slots), to avoid duplicate controls.
 * Does not include overflow recent tags; use `buildMoreQuickAddTagsSingle` for
 * the full “More” list. Returned names are sorted alphabetically for stable UI
 * (e.g. “More” menus).
 */
export function moreQuickAddTagsSingle(
  allKnownSorted: readonly string[],
  recentTagsInStrip: readonly string[],
  appliedTags: readonly string[]
): string[] {
  const recent = new Set(recentTagsInStrip)
  const applied = new Set(appliedTags)
  const out: string[] = []
  for (const tag of allKnownSorted) {
    if (applied.has(tag)) continue
    if (recent.has(tag)) continue
    out.push(tag)
  }
  return sortTagNamesAsc(out)
}

/** Multi-selection: tag is addable if at least one target file lacks it. */
export function moreQuickAddTagsMulti(
  allKnownSorted: readonly string[],
  recentTagsInStrip: readonly string[],
  targetKeys: readonly string[],
  fileTags: Readonly<Record<string, string[]>>
): string[] {
  const recent = new Set(recentTagsInStrip)
  const addable = (tag: string) =>
    !targetKeys.every(k => (fileTags[k] ?? []).includes(tag))
  const out: string[] = []
  for (const tag of allKnownSorted) {
    if (!addable(tag)) continue
    if (recent.has(tag)) continue
    out.push(tag)
  }
  return sortTagNamesAsc(out)
}

function mergeOverflowFirst(
  overflowOrdered: readonly string[],
  fromIndex: readonly string[]
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of overflowOrdered) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  for (const t of fromIndex) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * Full “More” quick-add list: overflow recent (after the visible strip) first,
 * then other index tags not in the strip and not yet applied (including tags
 * not in the index — only from overflow recent).
 */
export function buildMoreQuickAddTagsSingle(
  allKnownSorted: readonly string[],
  recentFull: readonly string[],
  appliedTags: readonly string[],
  visibleRecentCount: number
): string[] {
  const strip = recentFull.slice(0, visibleRecentCount)
  const overflow = recentFull.slice(visibleRecentCount)
  const applied = new Set(appliedTags)
  const overflowAddable = overflow.filter(t => !applied.has(t))
  const fromIndex = moreQuickAddTagsSingle(
    allKnownSorted,
    strip,
    appliedTags
  )
  return mergeOverflowFirst(overflowAddable, fromIndex)
}

/** Multi-selection variant of `buildMoreQuickAddTagsSingle`. */
export function buildMoreQuickAddTagsMulti(
  allKnownSorted: readonly string[],
  recentFull: readonly string[],
  visibleRecentCount: number,
  targetKeys: readonly string[],
  fileTags: Readonly<Record<string, string[]>>
): string[] {
  const strip = recentFull.slice(0, visibleRecentCount)
  const overflow = recentFull.slice(visibleRecentCount)
  const addable = (tag: string) =>
    !targetKeys.every(k => (fileTags[k] ?? []).includes(tag))
  const overflowAddable = overflow.filter(addable)
  const fromIndex = moreQuickAddTagsMulti(
    allKnownSorted,
    strip,
    targetKeys,
    fileTags
  )
  return mergeOverflowFirst(overflowAddable, fromIndex)
}

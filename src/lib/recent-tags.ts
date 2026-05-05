const STORAGE_KEY = 'degu_recent_tags'
const MAX = 60

/** How many recent tags show as primary quick-add chips; the rest go under "More". */
export const QUICK_ADD_RECENT_VISIBLE = 4

/** Remember tags the user has applied, for context-menu quick-add (newest first). */
export function recordTagApplied(tag: string): void {
  const t = tag.trim()
  if (!t) return
  const prev = getRecentTags()
  const next = [t, ...prev.filter(x => x !== t)].slice(0, MAX)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    for (const fn of listeners) fn()
  } catch {
    /* ignore quota / private mode */
  }
}

export function getRecentTags(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX)
  } catch {
    return []
  }
}

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeRecentTags(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

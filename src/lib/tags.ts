import type { TimestampMap, VideoLoop } from './index-json'
import { buildIndexJsonObject, parseIndexPayload } from './index-json'

export type { VideoLoop } from './index-json'
export { INDEX_META_KEY } from './index-json'

const API_TAGS = '/api/tags'
const SAVE_DEBOUNCE_MS = 400

/** In-memory tag map: path relative to root → tag list. Null until {@link initTagIndex} completes. */
let index: Record<string, string[]> | null = null

/** Video A–B loops keyed like tags; only paths with at least one loop appear. */
let videoLoopsMap: Record<string, VideoLoop[]> | null = null

/** First time we observed each tag name. ISO string from Date#toISOString(). */
let tagCreatedAtMap: TimestampMap | null = null

/** Last time we observed a deliberate tag edit on each path. */
let lastReviewedMap: TimestampMap | null = null

let saveTimer: ReturnType<typeof setTimeout> | null = null

async function writeStateToServer(): Promise<void> {
  if (!index) return
  const payload = buildIndexJsonObject(
    index,
    videoLoopsMap ?? {},
    tagCreatedAtMap ?? {},
    lastReviewedMap ?? {}
  )
  /**
   * `buildIndexJsonObject` produces the legacy `index.json` shape (top-level
   * keys are file paths; meta lives under `__degu`). The Go server expects
   * the flat `{tags, videoLoops, tagCreatedAt, lastReviewed}` shape, so we
   * unwrap before sending.
   */
  const body = JSON.stringify({
    tags: index,
    videoLoops: videoLoopsMap ?? {},
    tagCreatedAt: tagCreatedAtMap ?? {},
    lastReviewed: lastReviewedMap ?? {},
  })
  void payload
  const res = await fetch(API_TAGS, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  if (!res.ok) {
    throw new Error(`PUT ${API_TAGS} failed: ${res.status}`)
  }
}

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void writeStateToServer().catch(() => {
      /* write failed; data still in memory */
    })
  }, SAVE_DEBOUNCE_MS)
}

/**
 * Flush pending debounced writes. Call on `pagehide` / before unload.
 */
export function flushTagIndex(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  return writeStateToServer()
}

/**
 * Load the current tag state from the local degu server. Idempotent.
 */
export async function initTagIndex(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  index = null
  videoLoopsMap = {}
  tagCreatedAtMap = {}
  lastReviewedMap = {}

  try {
    const res = await fetch(API_TAGS, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      throw new Error(`GET ${API_TAGS}: ${res.status}`)
    }
    const json = (await res.json()) as {
      tags?: Record<string, string[]>
      videoLoops?: Record<string, VideoLoop[]>
      tagCreatedAt?: TimestampMap
      lastReviewed?: TimestampMap
    }
    /**
     * Re-use the legacy parser to defensively coerce any odd shapes — even
     * though the server emits clean JSON, this keeps a single normalization
     * point should the wire format ever drift.
     */
    const legacyShaped: Record<string, unknown> = { ...(json.tags ?? {}) }
    legacyShaped.__degu = {
      videoLoops: json.videoLoops ?? {},
      tagCreatedAt: json.tagCreatedAt ?? {},
      lastReviewed: json.lastReviewed ?? {},
    }
    const { tags, videoLoops, tagCreatedAt, lastReviewed } =
      parseIndexPayload(legacyShaped)
    index = tags
    videoLoopsMap = videoLoops
    tagCreatedAtMap = tagCreatedAt
    lastReviewedMap = lastReviewed
  } catch {
    index = {}
    videoLoopsMap = {}
    tagCreatedAtMap = {}
    lastReviewedMap = {}
  } finally {
    if (index === null) index = {}
  }
}

/** Load tags for a file identified by its path relative to the connected root. */
export function getTags(storageKey: string): string[] {
  if (!index) return []
  return index[storageKey] ?? []
}

/**
 * Like {@link getTags}, but reuses the result for the same key within one
 * `cache` (avoids repeated lookups in a directory walk).
 */
export function getTagsCached(
  storageKey: string,
  cache: Map<string, string[]>
): string[] {
  const hit = cache.get(storageKey)
  if (hit !== undefined) {
    return hit
  }
  const tags = getTags(storageKey)
  cache.set(storageKey, tags)
  return tags
}

/**
 * Stamp `tagCreatedAt` for any tag we've never seen before, and `lastReviewed`
 * for the path. Called whenever the user deliberately edits tags.
 */
function stampTimestamps(storageKey: string, tags: readonly string[]): void {
  if (!tagCreatedAtMap) tagCreatedAtMap = {}
  if (!lastReviewedMap) lastReviewedMap = {}
  const now = new Date().toISOString()
  for (const t of tags) {
    if (!t) continue
    if (tagCreatedAtMap[t] === undefined) {
      tagCreatedAtMap[t] = now
    }
  }
  lastReviewedMap[storageKey] = now
}

export function setTags(storageKey: string, tags: string[]): void {
  if (!index) {
    index = {}
  }
  if (tags.length === 0) {
    delete index[storageKey]
  } else {
    index[storageKey] = tags
  }
  stampTimestamps(storageKey, tags)
  bumpTagIndexVersion()
  scheduleSave()
}

/** Distinct tag strings used on any file (for autocomplete). */
export function getDistinctTagsFromIndex(): string[] {
  if (!index) return []
  const seen = new Set<string>()
  for (const arr of Object.values(index)) {
    for (const t of arr) {
      const u = t.trim()
      if (u) seen.add(u)
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/** ISO timestamp recording when this tag was first observed, or null if unknown. */
export function getTagCreatedAt(tag: string): string | null {
  if (!tagCreatedAtMap) return null
  return tagCreatedAtMap[tag] ?? null
}

/**
 * Stamp `lastReviewed` for a path without changing its tags. Use this when the
 * user has looked at a file and decided no tag change is needed (e.g. the
 * Triage "skip" action) — it removes the file from the stale-files queue.
 */
export function markReviewed(storageKey: string): void {
  if (!lastReviewedMap) lastReviewedMap = {}
  lastReviewedMap[storageKey] = new Date().toISOString()
  bumpTagIndexVersion()
  scheduleSave()
}

/** ISO timestamp of the most recent deliberate tag edit on this file, or null. */
export function getLastReviewed(storageKey: string): string | null {
  if (!lastReviewedMap) return null
  return lastReviewedMap[storageKey] ?? null
}

export type StaleFile = {
  /** Path relative to root. */
  path: string
  /** ISO of last review (or null if the file was never reviewed in this index). */
  lastReviewed: string | null
  /** Tags created after lastReviewed that the file does not currently have. */
  candidateTags: string[]
}

/**
 * Files whose `lastReviewed` predates the creation of one or more tags they
 * don't have. These are the candidates the user might want to revisit because
 * a newer tag may now apply.
 *
 * - Tags with no `tagCreatedAt` record (legacy / migrated) are ignored.
 * - Files with no `lastReviewed` record are treated as "never reviewed" and
 *   are flagged against every tag they don't have that has a known creation
 *   date.
 */
export function getStaleFiles(): StaleFile[] {
  if (!index) return []
  const created = tagCreatedAtMap ?? {}
  const reviewed = lastReviewedMap ?? {}
  const out: StaleFile[] = []
  for (const [path, fileTags] of Object.entries(index)) {
    const fileTagSet = new Set(fileTags)
    const lastReviewedAt = reviewed[path] ?? null
    const candidates: string[] = []
    for (const [tag, createdAt] of Object.entries(created)) {
      if (fileTagSet.has(tag)) continue
      if (lastReviewedAt === null || lastReviewedAt < createdAt) {
        candidates.push(tag)
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.localeCompare(b))
      out.push({ path, lastReviewed: lastReviewedAt, candidateTags: candidates })
    }
  }
  return out
}

/** Saved A–B loops for a video path (relative to root). */
export function getVideoLoops(storageKey: string): VideoLoop[] {
  if (!videoLoopsMap) return []
  return videoLoopsMap[storageKey] ?? []
}

export function setVideoLoops(storageKey: string, loops: VideoLoop[]): void {
  if (!videoLoopsMap) videoLoopsMap = {}
  if (loops.length === 0) {
    delete videoLoopsMap[storageKey]
  } else {
    videoLoopsMap[storageKey] = loops
  }
  bumpTagIndexVersion()
  scheduleSave()
}

let tagSaveSuppressed = 0

function renameTagStorageKeyCore(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return
  if (!index) index = {}
  if (!videoLoopsMap) videoLoopsMap = {}
  if (!lastReviewedMap) lastReviewedMap = {}
  const tags = index[oldKey]
  const loops = videoLoopsMap[oldKey]
  const reviewedAt = lastReviewedMap[oldKey]
  delete index[oldKey]
  delete videoLoopsMap[oldKey]
  delete lastReviewedMap[oldKey]
  if (tags && tags.length > 0) index[newKey] = tags
  else delete index[newKey]
  if (loops && loops.length > 0) videoLoopsMap[newKey] = loops
  else delete videoLoopsMap[newKey]
  if (reviewedAt) lastReviewedMap[newKey] = reviewedAt
  else delete lastReviewedMap[newKey]
}

/**
 * Move tags and video loops from `oldKey` to `newKey` after a file rename on disk.
 */
export function renameTagStorageKey(oldKey: string, newKey: string): void {
  renameTagStorageKeyCore(oldKey, newKey)
  if (tagSaveSuppressed === 0) {
    bumpTagIndexVersion()
    scheduleSave()
  }
}

/**
 * Apply several key renames in memory, then persist once (debounced).
 */
export function renameTagStorageKeysBatch(
  pairs: readonly { from: string; to: string }[]
): void {
  tagSaveSuppressed++
  try {
    for (const { from, to } of pairs) {
      renameTagStorageKeyCore(from, to)
    }
  } finally {
    tagSaveSuppressed--
    if (tagSaveSuppressed === 0) {
      bumpTagIndexVersion()
      scheduleSave()
    }
  }
}

/**
 * Bumped on every in-memory mutation of the tag index, video loops, or
 * timestamp maps. Screens that compute aggregates from the index can subscribe
 * via {@link subscribeTagIndexVersion} (or {@link useTagIndexVersion}) and
 * refresh their memos when this changes.
 */
let tagIndexVersion = 0
type VersionListener = () => void
const versionListeners = new Set<VersionListener>()

function bumpTagIndexVersion(): void {
  tagIndexVersion++
  for (const fn of versionListeners) fn()
}

export function getTagIndexVersion(): number {
  return tagIndexVersion
}

export function subscribeTagIndexVersion(fn: VersionListener): () => void {
  versionListeners.add(fn)
  return () => { versionListeners.delete(fn) }
}

export type TagIndexAggregate = {
  counts: { tag: string; count: number }[]
  /** Inverted index: tag name → paths (relative to root) that have it. */
  tagToPaths: Map<string, Set<string>>
}

/**
 * Sidebar counts + inverted index from the loaded tag map.
 * No filesystem walk — use after {@link initTagIndex} has run.
 */
export function buildAggregateFromTagIndex(): TagIndexAggregate {
  const tagToPaths = new Map<string, Set<string>>()
  if (!index) {
    return { counts: [], tagToPaths }
  }
  for (const [path, tags] of Object.entries(index)) {
    for (const t of tags) {
      let set = tagToPaths.get(t)
      if (!set) {
        set = new Set()
        tagToPaths.set(t, set)
      }
      set.add(path)
    }
  }
  const counts = [...tagToPaths.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tag, pathSet]) => ({ tag, count: pathSet.size }))
  return { counts, tagToPaths }
}

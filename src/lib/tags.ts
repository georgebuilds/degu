import type { TimestampMap, VideoLoop } from './index-json'
import { getActiveDriver } from './storage-driver'

export type { VideoLoop } from './index-json'
export { INDEX_META_KEY } from './index-json'

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

export type LoadState = 'idle' | 'loading' | 'loaded' | 'failed'
let loadState: LoadState = 'idle'
let loadError: Error | null = null
let lastSaveError: Error | null = null

/**
 * Single in-flight save promise; if a save request comes in while another is
 * running, we set `pendingSave` instead of starting a parallel write. The
 * in-flight save's `.finally` hook re-enters the writer if the flag is set.
 */
let inFlightSave: Promise<void> | null = null
let pendingSave = false
let pendingKeepalive = false

async function writeStateToBackend(keepalive: boolean): Promise<void> {
  if (!index || loadState !== 'loaded') return
  const driver = getActiveDriver()
  await driver.saveTags(
    {
      tags: index,
      videoLoops: videoLoopsMap ?? {},
      tagCreatedAt: tagCreatedAtMap ?? {},
      lastReviewed: lastReviewedMap ?? {},
    },
    keepalive ? { keepalive: true } : undefined
  )
}

/**
 * Trigger a save, serialising through `inFlightSave`. If a save is already
 * running, mark `pendingSave` and return — the runner will pick up the latest
 * state on completion.
 */
function triggerSave(keepalive = false): Promise<void> {
  if (loadState !== 'loaded') return Promise.resolve()
  if (keepalive) pendingKeepalive = true
  if (inFlightSave) {
    pendingSave = true
    return inFlightSave
  }
  const useKeepalive = keepalive || pendingKeepalive
  pendingKeepalive = false
  const run = (async () => {
    try {
      await writeStateToBackend(useKeepalive)
      lastSaveError = null
    } catch (e) {
      lastSaveError = e instanceof Error ? e : new Error(String(e))
      bumpTagIndexVersion()
    }
  })().finally(() => {
    inFlightSave = null
    if (pendingSave) {
      pendingSave = false
      void triggerSave()
    }
  })
  inFlightSave = run
  return run
}

function scheduleSave(): void {
  if (loadState !== 'loaded') return
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void triggerSave()
  }, SAVE_DEBOUNCE_MS)
}

/**
 * Flush pending debounced writes. Awaits any in-flight + pending save chain.
 * Call on `pagehide` / before unload.
 */
export async function flushTagIndex(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (loadState !== 'loaded') return
  await triggerSave()
  while (inFlightSave) {
    await inFlightSave
  }
}

/**
 * Like {@link flushTagIndex}, but tells the driver this is a `pagehide`
 * callback so it can use `keepalive: true` / `sendBeacon` to survive the
 * browser tearing down the page mid-fetch.
 */
export async function flushTagIndexBeacon(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (loadState !== 'loaded') return
  await triggerSave(true)
  while (inFlightSave) {
    await inFlightSave
  }
}

/**
 * Load the current tag state via the active storage driver.
 *
 * Requires `setActiveDriver` to have been called first (the boot sequence in
 * app.tsx connects the driver before invoking initTagIndex). On failure the
 * load state is set to `'failed'` and `index` is left null, which gates
 * `setTags` and friends so a follow-up mutation cannot overwrite the real
 * on-disk data with an empty payload.
 */
export async function initTagIndex(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  index = null
  videoLoopsMap = null
  tagCreatedAtMap = null
  lastReviewedMap = null
  loadState = 'loading'
  loadError = null
  lastSaveError = null

  try {
    const driver = getActiveDriver()
    const payload = await driver.loadTags()
    index = payload.tags
    videoLoopsMap = payload.videoLoops
    tagCreatedAtMap = payload.tagCreatedAt
    lastReviewedMap = payload.lastReviewed
    loadState = 'loaded'
    bumpTagIndexVersion()
  } catch (e) {
    loadState = 'failed'
    loadError = e instanceof Error ? e : new Error(String(e))
    bumpTagIndexVersion()
    throw loadError
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
  if (loadState !== 'loaded' || !index) return
  if (tags.length === 0) {
    delete index[storageKey]
  } else {
    index[storageKey] = tags
    stampTimestamps(storageKey, tags)
  }
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
  if (loadState !== 'loaded') return
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
  if (loadState !== 'loaded') return
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
  if (loadState !== 'loaded') return
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
  if (loadState !== 'loaded') return
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

export function getLoadState(): LoadState {
  return loadState
}

export function getLoadError(): Error | null {
  return loadError
}

export function getLastSaveError(): Error | null {
  return lastSaveError
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

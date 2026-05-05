/** Reserved `index.json` key for app metadata (not a tag storage path). */
export const INDEX_META_KEY = '__degu'

/** Min span (s) a stored video loop must have. Mirrors VIDEO_AB_LOOP_EPS in video-ab-loop.ts. Kept here as a dup constant to avoid an import cycle. */
const MIN_LOOP_DURATION_SEC = 0.04

export type VideoLoop = {
  id: string
  startSec: number
  endSec: number
}

/**
 * Map of timestamps keyed by tag name or file path. Values are ISO-8601
 * strings (UTC, `Date#toISOString()` format).
 */
export type TimestampMap = Record<string, string>

function normalizeTagRecord(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === INDEX_META_KEY) continue
    if (!Array.isArray(v)) continue
    const tags = v.filter((t): t is string => typeof t === 'string')
    if (tags.length > 0) out[k] = tags
  }
  return out
}

function getMetaBlock(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const meta = (raw as Record<string, unknown>)[INDEX_META_KEY]
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  return meta as Record<string, unknown>
}

function normalizeVideoLoopsRecord(raw: unknown): Record<string, VideoLoop[]> {
  const meta = getMetaBlock(raw)
  if (!meta) return {}
  const vl = meta.videoLoops
  if (!vl || typeof vl !== 'object' || Array.isArray(vl)) return {}
  const out: Record<string, VideoLoop[]> = {}
  for (const [path, arr] of Object.entries(vl as Record<string, unknown>)) {
    if (path === INDEX_META_KEY) continue
    if (!Array.isArray(arr)) continue
    const loops: VideoLoop[] = []
    for (const item of arr) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const o = item as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id : ''
      const startSec =
        typeof o.startSec === 'number' && Number.isFinite(o.startSec)
          ? o.startSec
          : NaN
      const endSec =
        typeof o.endSec === 'number' && Number.isFinite(o.endSec) ? o.endSec : NaN
      if (!id || !Number.isFinite(startSec) || !Number.isFinite(endSec)) continue
      if (endSec - startSec < MIN_LOOP_DURATION_SEC) continue
      loops.push({ id, startSec, endSec })
    }
    if (loops.length > 0) out[path] = loops
  }
  return out
}

function normalizeTimestampMap(raw: unknown): TimestampMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: TimestampMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string' || !v) continue
    /** Reject obviously bad timestamps; we don't validate full ISO grammar. */
    if (Number.isNaN(Date.parse(v))) continue
    out[k] = v
  }
  return out
}

/**
 * Parse a single `index.json` payload into tag, video-loop, and timestamp maps.
 */
export function parseIndexPayload(raw: unknown): {
  tags: Record<string, string[]>
  videoLoops: Record<string, VideoLoop[]>
  tagCreatedAt: TimestampMap
  lastReviewed: TimestampMap
} {
  const meta = getMetaBlock(raw)
  return {
    tags: normalizeTagRecord(raw),
    videoLoops: normalizeVideoLoopsRecord(raw),
    tagCreatedAt: meta ? normalizeTimestampMap(meta.tagCreatedAt) : {},
    lastReviewed: meta ? normalizeTimestampMap(meta.lastReviewed) : {},
  }
}

/**
 * Build the object written to `index.json` (tags + optional `__degu` block).
 */
export function buildIndexJsonObject(
  tags: Record<string, string[]>,
  videoLoops: Record<string, VideoLoop[]>,
  tagCreatedAt: TimestampMap = {},
  lastReviewed: TimestampMap = {}
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...tags }
  const meta: Record<string, unknown> = {}
  if (Object.keys(videoLoops).length > 0) {
    meta.videoLoops = { ...videoLoops }
  }
  if (Object.keys(tagCreatedAt).length > 0) {
    meta.tagCreatedAt = { ...tagCreatedAt }
  }
  if (Object.keys(lastReviewed).length > 0) {
    meta.lastReviewed = { ...lastReviewed }
  }
  if (Object.keys(meta).length > 0) {
    payload[INDEX_META_KEY] = meta
  }
  return payload
}

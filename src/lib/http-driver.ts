/**
 * HttpDriver — wraps the local Go server (`/api/*`) and exposes the
 * StorageDriver contract.
 *
 * The FSA-shaped rootHandle is HttpDirectoryHandle from http-handles.ts,
 * which already implements the FileSystemDirectoryHandle subset the SPA uses
 * (values, getFileHandle, getDirectoryHandle, removeEntry, resolve, …).
 *
 * Tag persistence goes to /api/tags; the on-the-wire shape is the flat
 * `{ tags, videoLoops, tagCreatedAt, lastReviewed }` JSON the Go server
 * emits, but we route it through `parseIndexPayload` for the same defensive
 * normalisation the FSA driver uses on disk.
 */

import { HttpDirectoryHandle } from './http-handles'
import { parseIndexPayload, type TimestampMap, type VideoLoop } from './index-json'
import type {
  SaveTagsOptions,
  StorageDriver,
  TagPayload,
} from './storage-driver'

const TAGS_API = '/api/tags'
const INFO_API = '/api/info'

const DETECT_TIMEOUT_MS = 3_000
const LOAD_TIMEOUT_MS = 15_000
const SAVE_TIMEOUT_MS = 30_000

/** Browser cap on `fetch({ keepalive: true })` body size. */
const KEEPALIVE_MAX_BYTES = 64 * 1024

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(new DOMException(`timed out after ${ms}ms`, 'TimeoutError')), ms)
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) }
}

export class HttpDriver implements StorageDriver {
  readonly kind = 'http' as const
  readonly rootHandle: FileSystemDirectoryHandle
  readonly rootName: string

  private constructor(rootName: string) {
    this.rootName = rootName
    const handle = new HttpDirectoryHandle({ name: rootName, relativePath: '' })
    this.rootHandle = handle as unknown as FileSystemDirectoryHandle
  }

  /**
   * Probe `/api/info` to confirm a Go server is reachable. Returns null on
   * any error (network, 404, non-JSON response, timeout) so the boot logic
   * can fall through to FSA mode.
   */
  static async detect(): Promise<HttpDriver | null> {
    const t = withTimeout(DETECT_TIMEOUT_MS)
    try {
      const r = await fetch(INFO_API, {
        headers: { Accept: 'application/json' },
        signal: t.signal,
      })
      if (!r.ok) return null
      const info = (await r.json()) as { root?: string }
      const root = info.root ?? ''
      const name = root.split('/').filter(Boolean).pop() ?? root ?? 'root'
      return new HttpDriver(name)
    } catch {
      return null
    } finally {
      t.cancel()
    }
  }

  async loadTags(): Promise<TagPayload> {
    const t = withTimeout(LOAD_TIMEOUT_MS)
    try {
      const res = await fetch(TAGS_API, {
        headers: { Accept: 'application/json' },
        signal: t.signal,
      })
      if (!res.ok) {
        throw new Error(`GET ${TAGS_API}: ${res.status}`)
      }
      const json = (await res.json()) as {
        tags?: Record<string, string[]>
        videoLoops?: Record<string, VideoLoop[]>
        tagCreatedAt?: TimestampMap
        lastReviewed?: TimestampMap
      }
      /**
       * The server emits a flat shape, but we re-shape it into the legacy
       * index.json layout (top-level path keys + `__degu` meta block) so the
       * existing `parseIndexPayload` defensive normaliser handles both wire
       * formats with one code path.
       */
      const legacyShaped: Record<string, unknown> = { ...(json.tags ?? {}) }
      legacyShaped.__degu = {
        videoLoops: json.videoLoops ?? {},
        tagCreatedAt: json.tagCreatedAt ?? {},
        lastReviewed: json.lastReviewed ?? {},
      }
      return parseIndexPayload(legacyShaped)
    } finally {
      t.cancel()
    }
  }

  async saveTags(payload: TagPayload, options?: SaveTagsOptions): Promise<void> {
    const body = JSON.stringify({
      tags: payload.tags,
      videoLoops: payload.videoLoops,
      tagCreatedAt: payload.tagCreatedAt,
      lastReviewed: payload.lastReviewed,
    })
    if (options?.keepalive) {
      await this.saveTagsKeepalive(body)
      return
    }
    const t = withTimeout(SAVE_TIMEOUT_MS)
    try {
      const res = await fetch(TAGS_API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: t.signal,
      })
      if (!res.ok) {
        throw new Error(`PUT ${TAGS_API}: ${res.status}`)
      }
    } finally {
      t.cancel()
    }
  }

  private async saveTagsKeepalive(body: string): Promise<void> {
    const size = new Blob([body]).size
    if (size <= KEEPALIVE_MAX_BYTES) {
      const res = await fetch(TAGS_API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })
      if (!res.ok) {
        throw new Error(`PUT ${TAGS_API}: ${res.status}`)
      }
      return
    }
    /**
     * Body too big for `keepalive` — sendBeacon survives unload but only
     * issues POST. The Go server accepts POST as a synonym for PUT on this
     * endpoint, so we POST and hope the browser delivers it.
     */
    const blob = new Blob([body], { type: 'application/json' })
    const ok = navigator.sendBeacon(TAGS_API, blob)
    if (!ok) {
      throw new Error(`sendBeacon ${TAGS_API} rejected`)
    }
  }
}

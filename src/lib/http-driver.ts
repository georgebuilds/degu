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

import {
  fetchStats as apiFetchStats,
  fileURL as apiFileURL,
  getInfo,
  moveBatch as apiMoveBatch,
  thumbURL as apiThumbURL,
  type StatsResponse,
} from './api-client'
import { HttpDirectoryHandle } from './http-handles'
import { parseIndexPayload, type TimestampMap, type VideoLoop } from './index-json'
import type {
  DriverCapabilities,
  DriverStatsResponse,
  StorageDriver,
  TagPayload,
} from './storage-driver'

const TAGS_API = '/api/tags'

const HTTP_CAPABILITIES: DriverCapabilities = {
  serverThumbnails: true,
  serverStats: true,
  batchMove: true,
  directFileURLs: true,
}

export class HttpDriver implements StorageDriver {
  readonly kind = 'http' as const
  readonly capabilities = HTTP_CAPABILITIES
  readonly rootHandle: FileSystemDirectoryHandle
  readonly rootName: string

  private constructor(rootName: string) {
    this.rootName = rootName
    const handle = new HttpDirectoryHandle({ name: rootName, relativePath: '' })
    this.rootHandle = handle as unknown as FileSystemDirectoryHandle
  }

  /**
   * Probe `/api/info` to confirm a Go server is reachable. Returns null on
   * any error (network, 404, non-JSON response) so the boot logic can fall
   * through to FSA mode.
   */
  static async detect(): Promise<HttpDriver | null> {
    try {
      const info = await getInfo()
      const name =
        info.root.split('/').filter(Boolean).pop() ?? info.root ?? 'root'
      return new HttpDriver(name)
    } catch {
      return null
    }
  }

  async loadTags(): Promise<TagPayload> {
    const res = await fetch(TAGS_API, { headers: { Accept: 'application/json' } })
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
  }

  async saveTags(payload: TagPayload): Promise<void> {
    const body = JSON.stringify({
      tags: payload.tags,
      videoLoops: payload.videoLoops,
      tagCreatedAt: payload.tagCreatedAt,
      lastReviewed: payload.lastReviewed,
    })
    const res = await fetch(TAGS_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok) {
      throw new Error(`PUT ${TAGS_API}: ${res.status}`)
    }
  }

  fetchStats(): Promise<DriverStatsResponse> {
    return apiFetchStats() as Promise<StatsResponse>
  }

  fileURL(relativePath: string): string {
    return apiFileURL(relativePath)
  }

  thumbURL(relativePath: string, width: number): string {
    return apiThumbURL(relativePath, width)
  }

  moveBatch(pairs: ReadonlyArray<{ from: string; to: string }>): Promise<void> {
    return apiMoveBatch(pairs)
  }
}

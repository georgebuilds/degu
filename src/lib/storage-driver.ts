/**
 * Storage drivers — the seam between degu's UI and where the bytes and
 * metadata actually live.
 *
 * Two drivers exist:
 *
 *   - **HttpDriver** talks to the local Go server (`/api/*`). This is what runs
 *     inside the Wails app, the headless `degu` CLI binary, and any other
 *     "degu running on this machine" deployment.
 *
 *   - **FsaDriver** uses the browser's File System Access API directly,
 *     storing tags and loops in `index.json` next to the media. This is the
 *     "drop the SPA bundle on a USB stick and open it in any chromium browser"
 *     mode — no server required.
 *
 * Both drivers expose a `rootHandle` that is structurally a
 * `FileSystemDirectoryHandle`. Component code (browse, preview, viewer pane,
 * trim, normalize, delete, search) programs against that FSA-shaped surface
 * and stays driver-agnostic. The driver adds the operations the FSA shape
 * doesn't cover — tag persistence.
 *
 * A module-level singleton (`active`) holds the connected driver so callers
 * don't have to prop-drill it through the component tree. tags.ts and other
 * persistence-aware modules read it via `getActiveDriver()`.
 *
 * @see http-driver.ts for the HTTP implementation.
 * @see fsa-driver.ts for the File System Access implementation.
 */

import type { TimestampMap, VideoLoop } from './index-json'

export type StorageDriverKind = 'http' | 'fsa'

/**
 * Tag + video-loop + timestamp payload, normalised across both drivers.
 * HttpDriver fetches it from `/api/tags`. FsaDriver reads `index.json` at root.
 */
export type TagPayload = {
  tags: Record<string, string[]>
  videoLoops: Record<string, VideoLoop[]>
  tagCreatedAt: TimestampMap
  lastReviewed: TimestampMap
}

export type SaveTagsOptions = {
  /** Hint that the caller is a `pagehide`/unload handler; driver may use `keepalive` / `sendBeacon`. */
  keepalive?: boolean
}

export type StorageDriver = {
  readonly kind: StorageDriverKind

  /** Root directory the SPA is scoped to. FSA-shaped for component compatibility. */
  readonly rootHandle: FileSystemDirectoryHandle

  /** Folder name shown in the mode rail and breadcrumb. */
  readonly rootName: string

  /** Load the persisted tag payload (empty record on first run). */
  loadTags(): Promise<TagPayload>

  /** Persist the tag payload. Called after the in-memory debounce in tags.ts. */
  saveTags(payload: TagPayload, options?: SaveTagsOptions): Promise<void>
}

/** Module-level active driver. tags.ts and components read this to dispatch. */
let active: StorageDriver | null = null

export function setActiveDriver(driver: StorageDriver): void {
  active = driver
}

export function clearActiveDriver(): void {
  active = null
}

/** Throws if no driver is connected. Callers in steady-state can rely on this. */
export function getActiveDriver(): StorageDriver {
  if (!active) {
    throw new Error('storage driver: no active driver (called before app boot finished?)')
  }
  return active
}

/** Returns null instead of throwing — for boot-time code that runs before connection. */
export function getActiveDriverOrNull(): StorageDriver | null {
  return active
}

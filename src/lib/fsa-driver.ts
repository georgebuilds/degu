/**
 * FsaDriver — uses the browser's File System Access API directly.
 *
 * Tags and video loops are persisted to `index.json` at the connected root.
 * The on-disk format is the legacy "top-level path keys + `__degu` meta block"
 * layout that `parseIndexPayload` / `buildIndexJsonObject` already speak —
 * the same format the Go server's `MaybeImportLegacyIndex` knows how to read,
 * so a folder used in HTTP mode then opened in FSA mode (or vice-versa) sees
 * the same tag state.
 *
 * Connection requires a user gesture (`showDirectoryPicker`), so the boot
 * sequence in app.tsx renders a "pick folder" UI when the HTTP driver isn't
 * reachable and FSA is the available fallback.
 */

import {
  buildIndexJsonObject,
  parseIndexPayload,
} from './index-json'
import type {
  DriverCapabilities,
  StorageDriver,
  TagPayload,
} from './storage-driver'

const INDEX_FILE = 'index.json'

const FSA_CAPABILITIES: DriverCapabilities = {
  serverThumbnails: false,
  serverStats: false,
  batchMove: false,
  directFileURLs: false,
}

type ShowDirectoryPicker = (options?: {
  mode?: 'read' | 'readwrite'
  id?: string
}) => Promise<FileSystemDirectoryHandle>

type WritableFileStream = {
  write(data: BufferSource | Blob | string): Promise<void>
  close(): Promise<void>
}

type WritableCapableFileHandle = FileSystemFileHandle & {
  createWritable(options?: {
    keepExistingData?: boolean
  }): Promise<WritableFileStream>
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export class FsaDriver implements StorageDriver {
  readonly kind = 'fsa' as const
  readonly capabilities = FSA_CAPABILITIES
  readonly rootHandle: FileSystemDirectoryHandle
  readonly rootName: string

  private constructor(handle: FileSystemDirectoryHandle) {
    this.rootHandle = handle
    this.rootName = handle.name
  }

  /** Prompts the user to pick a folder. MUST be invoked from a user gesture. */
  static async connect(): Promise<FsaDriver> {
    if (!isFileSystemAccessSupported()) {
      throw new Error('File System Access API is not supported in this browser.')
    }
    const sdp = (window as unknown as { showDirectoryPicker: ShowDirectoryPicker })
      .showDirectoryPicker
    const handle = await sdp({ mode: 'readwrite', id: 'degu-root' })
    return new FsaDriver(handle)
  }

  /**
   * Re-attach to a previously-stored handle (from IndexedDB). Re-grants
   * permission if the browser allows querying without a gesture; otherwise
   * the caller must do this from a click handler.
   */
  static async reconnect(handle: FileSystemDirectoryHandle): Promise<FsaDriver> {
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') return new FsaDriver(handle)
    const requested = await handle.requestPermission({ mode: 'readwrite' })
    if (requested !== 'granted') {
      throw new Error('Permission to read/write the folder was denied.')
    }
    return new FsaDriver(handle)
  }

  async loadTags(): Promise<TagPayload> {
    try {
      const fh = await this.rootHandle.getFileHandle(INDEX_FILE)
      const file = await fh.getFile()
      const text = await file.text()
      if (!text.trim()) {
        return emptyPayload()
      }
      const json = JSON.parse(text) as unknown
      return parseIndexPayload(json)
    } catch (e) {
      // First run on this folder — no index.json yet. Treat as empty.
      if (e instanceof DOMException && e.name === 'NotFoundError') {
        return emptyPayload()
      }
      // Corrupt JSON should not blow up boot — log via the thrown error and
      // start fresh. The user can restore from a backup if they have one.
      if (e instanceof SyntaxError) {
        return emptyPayload()
      }
      throw e
    }
  }

  async saveTags(payload: TagPayload): Promise<void> {
    const obj = buildIndexJsonObject(
      payload.tags,
      payload.videoLoops,
      payload.tagCreatedAt,
      payload.lastReviewed
    )
    const text = JSON.stringify(obj, null, 2)
    const fh = (await this.rootHandle.getFileHandle(INDEX_FILE, {
      create: true,
    })) as WritableCapableFileHandle
    const writable = await fh.createWritable()
    try {
      await writable.write(text)
    } finally {
      await writable.close()
    }
  }
}

function emptyPayload(): TagPayload {
  return {
    tags: {},
    videoLoops: {},
    tagCreatedAt: {},
    lastReviewed: {},
  }
}

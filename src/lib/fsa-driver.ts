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
  StorageDriver,
  TagPayload,
} from './storage-driver'

const INDEX_FILE = 'index.json'
const INDEX_TMP_FILE = 'index.json.tmp'
const INDEX_BAK_FILE = 'index.json.bak'

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

type MoveCapableFileHandle = FileSystemFileHandle & {
  move(newName: string): Promise<void>
  move(parent: FileSystemDirectoryHandle, newName: string): Promise<void>
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export class FsaDriver implements StorageDriver {
  readonly kind = 'fsa' as const
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
    let text: string
    try {
      const fh = await this.rootHandle.getFileHandle(INDEX_FILE)
      const file = await fh.getFile()
      text = await file.text()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') {
        return emptyPayload()
      }
      throw e
    }
    if (!text.trim()) {
      return emptyPayload()
    }
    /**
     * Surface SyntaxError so the caller can refuse to overwrite a corrupt
     * file on the next save. A silent reset would let one bad parse wipe
     * the user's tags.
     */
    const json = JSON.parse(text) as unknown
    return parseIndexPayload(json)
  }

  async saveTags(payload: TagPayload): Promise<void> {
    const obj = buildIndexJsonObject(
      payload.tags,
      payload.videoLoops,
      payload.tagCreatedAt,
      payload.lastReviewed
    )
    const text = JSON.stringify(obj, null, 2)

    const tmp = (await this.rootHandle.getFileHandle(INDEX_TMP_FILE, {
      create: true,
    })) as WritableCapableFileHandle
    const writable = await tmp.createWritable()
    let writeOk = false
    try {
      await writable.write(text)
      writeOk = true
    } finally {
      if (!writeOk) {
        try { await writable.close() } catch { /* swallow */ }
      } else {
        await writable.close()
      }
    }

    if (await tryRenameTmpOverIndex(tmp)) {
      return
    }

    /**
     * `move` unavailable — fall back to bak/replace/cleanup. We still get
     * crash safety: at any point the user has either the previous index in
     * place, the previous index in `.bak`, or the new index plus a leftover
     * `.bak` they can delete.
     */
    await this.fallbackBakReplace(text)
    await this.removeIfExists(INDEX_TMP_FILE)
  }

  private async fallbackBakReplace(text: string): Promise<void> {
    const existing = await this.readIfExists(INDEX_FILE)
    if (existing !== null) {
      const bak = (await this.rootHandle.getFileHandle(INDEX_BAK_FILE, {
        create: true,
      })) as WritableCapableFileHandle
      const w = await bak.createWritable()
      try {
        await w.write(existing)
      } finally {
        await w.close()
      }
    }
    const real = (await this.rootHandle.getFileHandle(INDEX_FILE, {
      create: true,
    })) as WritableCapableFileHandle
    const w = await real.createWritable()
    try {
      await w.write(text)
    } finally {
      await w.close()
    }
    await this.removeIfExists(INDEX_BAK_FILE)
  }

  private async readIfExists(name: string): Promise<string | null> {
    try {
      const fh = await this.rootHandle.getFileHandle(name)
      const f = await fh.getFile()
      return await f.text()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return null
      throw e
    }
  }

  private async removeIfExists(name: string): Promise<void> {
    try {
      await this.rootHandle.removeEntry(name)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return
      throw e
    }
  }
}

async function tryRenameTmpOverIndex(
  tmp: FileSystemFileHandle
): Promise<boolean> {
  const moveable = tmp as Partial<MoveCapableFileHandle>
  if (typeof moveable.move !== 'function') return false
  try {
    await (moveable.move as (n: string) => Promise<void>)(INDEX_FILE)
    return true
  } catch {
    return false
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

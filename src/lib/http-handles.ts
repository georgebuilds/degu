/**
 * HTTP-backed shims that quack like the File System Access API.
 *
 * The SPA was originally built directly against `FileSystemDirectoryHandle`
 * and `FileSystemFileHandle`. Now that the Go server owns the filesystem we
 * keep the public shape unchanged so component code (preview, viewer, trim,
 * normalize, delete, search, …) stays untouched — they ask for `.getFile()`,
 * iterate `.values()`, call `.removeEntry()` / `.move()`, and these classes
 * dispatch to `/api/*`.
 *
 * Two trade-offs to keep in mind:
 *   1. `getFile()` does a fresh HTTP fetch each call. That's the same model
 *      browsers use when a Blob is produced from a file handle, just with a
 *      round-trip to localhost instead of disk.
 *   2. `values()` and `getFileHandle()` share a coalescing scanRoot()
 *      cache (small TTL + in-flight de-dupe) which is invalidated on any
 *      mutation through this module (delete, move, save).
 */
import {
  deleteFile,
  fetchFile,
  fileURL,
  getInfo,
  moveFile,
  saveFile,
  scanRoot,
  type ScanEntry,
  type ScanResponse,
} from './api-client'

/**
 * Coalescing cache for scanRoot(): a single in-flight scan is shared across
 * concurrent callers and a tiny TTL absorbs bursts during a render pass.
 * Mutations through this module bust the cache via invalidateScanCache().
 */
const SCAN_CACHE_TTL_MS = 1500
let inFlightScan: Promise<ScanResponse> | null = null
let lastScan: { result: ScanResponse; ts: number } | null = null

async function scanRootCached(): Promise<ScanResponse> {
  if (lastScan && Date.now() - lastScan.ts < SCAN_CACHE_TTL_MS) {
    return lastScan.result
  }
  if (inFlightScan) return inFlightScan
  const p = scanRoot()
    .then(result => {
      lastScan = { result, ts: Date.now() }
      return result
    })
    .finally(() => {
      if (inFlightScan === p) inFlightScan = null
    })
  inFlightScan = p
  return p
}

export function invalidateScanCache(): void {
  lastScan = null
}

/**
 * Cached liveness probe for permission queries. Pings /api/info; if the
 * server is reachable we report 'granted', otherwise 'denied'. Cached so
 * a render burst can't hammer the endpoint.
 */
const PERMISSION_PROBE_TTL_MS = 5000
let lastPermissionProbe: { result: 'granted' | 'denied'; ts: number } | null =
  null
let inFlightPermissionProbe: Promise<'granted' | 'denied'> | null = null

async function probeServerPermission(): Promise<'granted' | 'denied'> {
  const now = Date.now()
  if (lastPermissionProbe && now - lastPermissionProbe.ts < PERMISSION_PROBE_TTL_MS) {
    return lastPermissionProbe.result
  }
  if (inFlightPermissionProbe) return inFlightPermissionProbe
  const p = (async () => {
    try {
      await getInfo()
      return 'granted' as const
    } catch {
      return 'denied' as const
    }
  })().then(result => {
    lastPermissionProbe = { result, ts: Date.now() }
    return result
  }).finally(() => {
    if (inFlightPermissionProbe === p) inFlightPermissionProbe = null
  })
  inFlightPermissionProbe = p
  return p
}

function joinRel(parent: string, name: string): string {
  if (parent === '') return name
  return `${parent}/${name}`
}

function dirnameOf(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i === -1 ? '' : rel.slice(0, i)
}

/**
 * Represents a single file at `relativePath` inside the connected root.
 *
 * Implements the subset of `FileSystemFileHandle` the SPA actually uses:
 *   - kind, name
 *   - getFile()
 *   - createWritable() (write-once, then close — enough for trim output)
 *   - move(name) (rename in-place)
 *   - queryPermission/requestPermission (always granted; the server mediates)
 */
export class HttpFileHandle {
  readonly kind = 'file' as const
  readonly name: string
  readonly relativePath: string
  readonly size: number
  readonly lastModified: number

  constructor(init: {
    name: string
    relativePath: string
    size: number
    lastModified: number
  }) {
    this.name = init.name
    this.relativePath = init.relativePath
    this.size = init.size
    this.lastModified = init.lastModified
  }

  async getFile(): Promise<File> {
    const blob = await fetchFile(this.relativePath)
    return new File([blob], this.name, {
      type: blob.type,
      lastModified: this.lastModified,
    })
  }

  /** Direct URL the browser can use as `<img src>` / `<video src>`. */
  url(): string {
    return fileURL(this.relativePath)
  }

  async createWritable(): Promise<HttpFileWritable> {
    return new HttpFileWritable(this.relativePath, true)
  }

  /**
   * Rename inside the same parent directory. The FSA `move` accepts either a
   * new name (string) or a directory handle + new name; the SPA only uses
   * the single-string form.
   */
  async move(newName: string): Promise<void> {
    const parent = dirnameOf(this.relativePath)
    const to = joinRel(parent, newName)
    await moveFile(this.relativePath, to)
    invalidateScanCache()
    // The handle is now stale; callers re-resolve from a fresh scan.
  }

  async queryPermission(): Promise<'granted' | 'denied'> {
    return probeServerPermission()
  }

  async requestPermission(): Promise<'granted' | 'denied'> {
    return probeServerPermission()
  }
}

/**
 * Buffers writes in memory, then PUTs the whole payload on close. Matches the
 * FSA pattern of `await w.write(blob); await w.close()` that
 * save-trimmed-video.ts uses; multi-chunk streaming isn't needed for our
 * trim outputs.
 */
type WriteChunkParam =
  | BlobPart
  | { type: 'write'; data: BlobPart }
  | { type: 'seek'; position: number }
  | { type: 'truncate'; size: number }

export class HttpFileWritable {
  private chunks: BlobPart[] = []
  private closed = false
  private readonly relativePath: string
  private readonly overwrite: boolean

  constructor(relativePath: string, overwrite: boolean) {
    this.relativePath = relativePath
    this.overwrite = overwrite
  }

  async write(data: WriteChunkParam): Promise<void> {
    if (this.closed) throw new Error('writable already closed')
    // BlobPart — push verbatim. (Blob also has a `type` field for MIME, hence
    // the explicit instance check before the discriminated-union branch.)
    if (
      data instanceof Blob ||
      data instanceof ArrayBuffer ||
      ArrayBuffer.isView(data) ||
      typeof data === 'string'
    ) {
      this.chunks.push(data as BlobPart)
      return
    }
    if (data && typeof data === 'object' && 'type' in data) {
      const tag = (data as { type: string }).type
      if (tag === 'write') {
        this.chunks.push((data as { type: 'write'; data: BlobPart }).data)
        return
      }
      // 'seek' / 'truncate' aren't supported by this buffer-and-PUT writable.
      throw new Error(`HttpFileWritable: unsupported chunk type "${tag}"`)
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const blob = new Blob(this.chunks)
    await saveFile(this.relativePath, blob, { overwrite: this.overwrite })
    invalidateScanCache()
  }

  async abort(): Promise<void> {
    this.closed = true
    this.chunks = []
  }
}

/**
 * Wraps a directory at `relativePath`. Implements the FSA subset the SPA uses:
 *   - kind, name
 *   - values() — async iterable of immediate children (files + dirs)
 *   - getFileHandle / getDirectoryHandle (with optional create:true for files)
 *   - removeEntry — deletes a child by name
 *   - resolve — relative path segments from root to a descendant
 *   - queryPermission / requestPermission
 */
export class HttpDirectoryHandle {
  readonly kind = 'directory' as const
  readonly name: string
  readonly relativePath: string

  constructor(init: { name: string; relativePath: string }) {
    this.name = init.name
    this.relativePath = init.relativePath
  }

  async *values(): AsyncIterableIterator<HttpFileHandle | HttpDirectoryHandle> {
    const scan = await scanRootCached()
    yield* this.childrenFromScan(scan.entries)
  }

  *childrenFromScan(
    entries: ReadonlyArray<ScanEntry>
  ): IterableIterator<HttpFileHandle | HttpDirectoryHandle> {
    const seenSubdirs = new Set<string>()
    const prefix = this.relativePath === '' ? '' : `${this.relativePath}/`
    for (const entry of entries) {
      if (this.relativePath !== '' && !entry.path.startsWith(prefix)) continue
      const tail = entry.path.slice(prefix.length)
      if (tail === '') continue
      const slash = tail.indexOf('/')
      if (slash === -1) {
        yield new HttpFileHandle({
          name: tail,
          relativePath: entry.path,
          size: entry.size,
          lastModified: entry.modTime,
        })
      } else {
        const subName = tail.slice(0, slash)
        if (seenSubdirs.has(subName)) continue
        seenSubdirs.add(subName)
        yield new HttpDirectoryHandle({
          name: subName,
          relativePath: prefix + subName,
        })
      }
    }
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<HttpFileHandle> {
    const rel = joinRel(this.relativePath, name)
    if (options?.create) {
      // FSA semantics: create-if-missing returns a usable handle even before
      // anything is written. Our equivalent: pre-bind a handle; the actual
      // file appears once the writable is closed (saveFile with overwrite
      // when needed).
      return new HttpFileHandle({
        name,
        relativePath: rel,
        size: 0,
        lastModified: Date.now(),
      })
    }
    const scan = await scanRootCached()
    const entry = scan.entries.find(e => e.path === rel)
    if (!entry) {
      throw notFound(`getFileHandle: ${rel}`)
    }
    return new HttpFileHandle({
      name: entry.name,
      relativePath: entry.path,
      size: entry.size,
      lastModified: entry.modTime,
    })
  }

  async getDirectoryHandle(
    name: string,
    _options?: { create?: boolean }
  ): Promise<HttpDirectoryHandle> {
    /**
     * We don't track directories in the scan response (server only emits
     * media files), so the existence check is implicit: any directory whose
     * subtree contains files is reachable. For empty subdirectories the
     * handle is still useful — the SPA navigates by path and discovers
     * emptiness through values().
     */
    return new HttpDirectoryHandle({
      name,
      relativePath: joinRel(this.relativePath, name),
    })
  }

  async removeEntry(name: string, _options?: { recursive?: boolean }): Promise<void> {
    const rel = joinRel(this.relativePath, name)
    await deleteFile(rel)
    invalidateScanCache()
  }

  /**
   * FSA's `resolve(child)` returns the segments from this directory to the
   * descendant. The SPA mostly uses it on the root, where the answer is the
   * descendant's relativePath split on '/'.
   */
  async resolve(
    descendant: HttpFileHandle | HttpDirectoryHandle
  ): Promise<string[] | null> {
    if (descendant.relativePath === this.relativePath) return []
    const prefix = this.relativePath === '' ? '' : `${this.relativePath}/`
    if (!descendant.relativePath.startsWith(prefix)) return null
    return descendant.relativePath.slice(prefix.length).split('/')
  }

  async queryPermission(): Promise<'granted' | 'denied'> {
    return probeServerPermission()
  }

  async requestPermission(): Promise<'granted' | 'denied'> {
    return probeServerPermission()
  }
}

function notFound(message: string): DOMException {
  return new DOMException(message, 'NotFoundError')
}

/**
 * Build a root HttpDirectoryHandle for the connected server. Pulls the root
 * folder's display name from /api/info.
 */
export async function buildRootHandle(rootName: string): Promise<HttpDirectoryHandle> {
  return new HttpDirectoryHandle({ name: rootName, relativePath: '' })
}

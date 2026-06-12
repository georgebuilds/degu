import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ScanResponse } from './api-client'

vi.mock('./api-client', () => ({
  scanRoot: vi.fn(),
  getInfo: vi.fn(),
  fetchFile: vi.fn(),
  fileURL: vi.fn(),
  saveFile: vi.fn(),
  moveFile: vi.fn(),
  deleteFile: vi.fn(),
}))

import {
  HttpFileHandle,
  HttpFileWritable,
  HttpDirectoryHandle,
  invalidateScanCache,
  buildRootHandle,
} from './http-handles'
import * as api from './api-client'

const mocked = api as unknown as {
  scanRoot: ReturnType<typeof vi.fn>
  getInfo: ReturnType<typeof vi.fn>
  fetchFile: ReturnType<typeof vi.fn>
  fileURL: ReturnType<typeof vi.fn>
  saveFile: ReturnType<typeof vi.fn>
  moveFile: ReturnType<typeof vi.fn>
  deleteFile: ReturnType<typeof vi.fn>
}

function scan(entries: Array<{ path: string; name?: string; size?: number; modTime?: number }>): ScanResponse {
  return {
    entries: entries.map(e => ({
      path: e.path,
      name: e.name ?? e.path.split('/').pop()!,
      size: e.size ?? 0,
      modTime: e.modTime ?? 0,
    })),
  } as unknown as ScanResponse
}

async function collect<T>(it: AsyncIterableIterator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of it) out.push(v)
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateScanCache()
})

describe('HttpFileHandle', () => {
  it('getFile() wraps the fetched blob into a named File', async () => {
    mocked.fetchFile.mockResolvedValue(new Blob(['hi'], { type: 'video/mp4' }))
    const h = new HttpFileHandle({ name: 'a.mp4', relativePath: 'dir/a.mp4', size: 2, lastModified: 123 })
    const file = await h.getFile()
    expect(mocked.fetchFile).toHaveBeenCalledWith('dir/a.mp4')
    expect(file.name).toBe('a.mp4')
    expect(file.type).toBe('video/mp4')
    expect(file.lastModified).toBe(123)
  })

  it('url() delegates to fileURL', () => {
    mocked.fileURL.mockReturnValue('/api/file/dir/a.mp4')
    const h = new HttpFileHandle({ name: 'a.mp4', relativePath: 'dir/a.mp4', size: 0, lastModified: 0 })
    expect(h.url()).toBe('/api/file/dir/a.mp4')
    expect(mocked.fileURL).toHaveBeenCalledWith('dir/a.mp4')
  })

  it('createWritable() returns an HttpFileWritable', async () => {
    const h = new HttpFileHandle({ name: 'a.mp4', relativePath: 'a.mp4', size: 0, lastModified: 0 })
    expect(await h.createWritable()).toBeInstanceOf(HttpFileWritable)
  })

  it('move() renames within the parent dir and busts the cache', async () => {
    mocked.scanRoot.mockResolvedValue(scan([{ path: 'dir/a.mp4' }]))
    mocked.moveFile.mockResolvedValue(undefined)
    // Prime the cache.
    const root = new HttpDirectoryHandle({ name: 'root', relativePath: '' })
    await collect(root.values())
    expect(mocked.scanRoot).toHaveBeenCalledTimes(1)

    const h = new HttpFileHandle({ name: 'a.mp4', relativePath: 'dir/a.mp4', size: 0, lastModified: 0 })
    await h.move('b.mp4')
    expect(mocked.moveFile).toHaveBeenCalledWith('dir/a.mp4', 'dir/b.mp4')

    // Cache invalidated -> next values() re-scans.
    await collect(root.values())
    expect(mocked.scanRoot).toHaveBeenCalledTimes(2)
  })

  it('move() of a root-level file targets the bare new name', async () => {
    mocked.moveFile.mockResolvedValue(undefined)
    const h = new HttpFileHandle({ name: 'a.mp4', relativePath: 'a.mp4', size: 0, lastModified: 0 })
    await h.move('b.mp4')
    expect(mocked.moveFile).toHaveBeenCalledWith('a.mp4', 'b.mp4')
  })

  it('permission queries probe the server (granted when reachable)', async () => {
    // Advance Date.now past the 5s probe TTL so this test does not see a
    // cached result from an earlier permission test.
    vi.useFakeTimers()
    vi.advanceTimersByTime(100_000)
    try {
      mocked.getInfo.mockResolvedValue({ root: '/r' })
      const h = new HttpFileHandle({ name: 'a', relativePath: 'a', size: 0, lastModified: 0 })
      await expect(h.queryPermission()).resolves.toBe('granted')
      await expect(h.requestPermission()).resolves.toBe('granted')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('HttpFileWritable', () => {
  it('buffers blob/string/buffer chunks and PUTs them on close', async () => {
    mocked.saveFile.mockResolvedValue(undefined)
    const w = new HttpFileWritable('out.mp4', true)
    await w.write('a')
    await w.write(new Blob(['b']))
    await w.write(new Uint8Array([99]))
    await w.write(new ArrayBuffer(1))
    await w.close()
    expect(mocked.saveFile).toHaveBeenCalledTimes(1)
    const [path, blob, opts] = mocked.saveFile.mock.calls[0]
    expect(path).toBe('out.mp4')
    expect(blob).toBeInstanceOf(Blob)
    expect(opts).toEqual({ overwrite: true })
  })

  it('accepts the { type: "write", data } chunk form', async () => {
    mocked.saveFile.mockResolvedValue(undefined)
    const w = new HttpFileWritable('out.mp4', false)
    await w.write({ type: 'write', data: 'payload' })
    await w.close()
    const blob: Blob = mocked.saveFile.mock.calls[0][1]
    expect(await blob.text()).toBe('payload')
  })

  it('rejects seek / truncate chunk types', async () => {
    const w = new HttpFileWritable('out.mp4', true)
    await expect(w.write({ type: 'seek', position: 0 })).rejects.toThrow(
      'unsupported chunk type "seek"',
    )
    await expect(w.write({ type: 'truncate', size: 0 })).rejects.toThrow(
      'unsupported chunk type "truncate"',
    )
  })

  it('throws when writing after close', async () => {
    mocked.saveFile.mockResolvedValue(undefined)
    const w = new HttpFileWritable('out.mp4', true)
    await w.close()
    await expect(w.write('x')).rejects.toThrow('writable already closed')
  })

  it('close() is idempotent (second close is a no-op)', async () => {
    mocked.saveFile.mockResolvedValue(undefined)
    const w = new HttpFileWritable('out.mp4', true)
    await w.close()
    await w.close()
    expect(mocked.saveFile).toHaveBeenCalledTimes(1)
  })

  it('abort() clears buffered chunks and prevents saving', async () => {
    const w = new HttpFileWritable('out.mp4', true)
    await w.write('discard me')
    await w.abort()
    await w.close()
    expect(mocked.saveFile).not.toHaveBeenCalled()
  })
})

describe('HttpDirectoryHandle.values / childrenFromScan', () => {
  it('yields immediate file children and de-duped subdirectories from root', async () => {
    mocked.scanRoot.mockResolvedValue(
      scan([
        { path: 'top.mp4', size: 10, modTime: 5 },
        { path: 'sub/x.mp4' },
        { path: 'sub/y.mp4' },
        { path: 'sub/deep/z.mp4' },
      ]),
    )
    const root = new HttpDirectoryHandle({ name: 'root', relativePath: '' })
    const kids = await collect(root.values())
    const files = kids.filter(k => k.kind === 'file')
    const dirs = kids.filter(k => k.kind === 'directory')
    expect(files.map(f => f.name)).toEqual(['top.mp4'])
    expect(dirs.map(d => d.name)).toEqual(['sub'])
    expect((files[0] as HttpFileHandle).size).toBe(10)
    expect((files[0] as HttpFileHandle).lastModified).toBe(5)
  })

  it('scopes children to a non-root subdirectory and ignores other prefixes', async () => {
    mocked.scanRoot.mockResolvedValue(
      scan([
        { path: 'sub/a.mp4' },
        { path: 'sub/nested/b.mp4' },
        { path: 'other/c.mp4' },
      ]),
    )
    const sub = new HttpDirectoryHandle({ name: 'sub', relativePath: 'sub' })
    const kids = await collect(sub.values())
    expect(kids.map(k => `${k.kind}:${k.name}`).sort()).toEqual([
      'directory:nested',
      'file:a.mp4',
    ])
  })

  it('skips the entry equal to the directory prefix itself', async () => {
    // An entry whose path is exactly the prefix yields an empty tail and is skipped.
    mocked.scanRoot.mockResolvedValue(scan([{ path: 'sub' }, { path: 'sub/a.mp4' }]))
    const sub = new HttpDirectoryHandle({ name: 'sub', relativePath: 'sub' })
    const kids = await collect(sub.values())
    expect(kids.map(k => k.name)).toEqual(['a.mp4'])
  })

  it('coalesces concurrent scans into one in-flight request', async () => {
    let resolveScan: (v: ScanResponse) => void = () => {}
    mocked.scanRoot.mockReturnValue(
      new Promise<ScanResponse>(res => {
        resolveScan = res
      }),
    )
    const root = new HttpDirectoryHandle({ name: 'root', relativePath: '' })
    const p1 = collect(root.values())
    const p2 = collect(root.values())
    resolveScan(scan([{ path: 'a.mp4' }]))
    await Promise.all([p1, p2])
    expect(mocked.scanRoot).toHaveBeenCalledTimes(1)
  })

  it('serves a second call from the TTL cache', async () => {
    mocked.scanRoot.mockResolvedValue(scan([{ path: 'a.mp4' }]))
    const root = new HttpDirectoryHandle({ name: 'root', relativePath: '' })
    await collect(root.values())
    await collect(root.values())
    expect(mocked.scanRoot).toHaveBeenCalledTimes(1)
  })
})

describe('HttpDirectoryHandle.getFileHandle', () => {
  it('create:true returns a pre-bound handle without scanning', async () => {
    const dir = new HttpDirectoryHandle({ name: 'sub', relativePath: 'sub' })
    const h = await dir.getFileHandle('new.mp4', { create: true })
    expect(h.relativePath).toBe('sub/new.mp4')
    expect(h.size).toBe(0)
    expect(mocked.scanRoot).not.toHaveBeenCalled()
  })

  it('resolves an existing file from the scan', async () => {
    mocked.scanRoot.mockResolvedValue(
      scan([{ path: 'sub/a.mp4', size: 7, modTime: 9 }]),
    )
    const dir = new HttpDirectoryHandle({ name: 'sub', relativePath: 'sub' })
    const h = await dir.getFileHandle('a.mp4')
    expect(h.relativePath).toBe('sub/a.mp4')
    expect(h.size).toBe(7)
    expect(h.lastModified).toBe(9)
  })

  it('throws a NotFoundError when the file is absent', async () => {
    mocked.scanRoot.mockResolvedValue(scan([{ path: 'sub/a.mp4' }]))
    const dir = new HttpDirectoryHandle({ name: 'sub', relativePath: 'sub' })
    await expect(dir.getFileHandle('missing.mp4')).rejects.toMatchObject({
      name: 'NotFoundError',
    })
  })
})

describe('HttpDirectoryHandle.getDirectoryHandle / removeEntry / resolve', () => {
  it('getDirectoryHandle returns a child handle by joined path', async () => {
    const root = new HttpDirectoryHandle({ name: 'root', relativePath: '' })
    const sub = await root.getDirectoryHandle('sub')
    expect(sub.relativePath).toBe('sub')
    const nested = await sub.getDirectoryHandle('deep')
    expect(nested.relativePath).toBe('sub/deep')
  })

  it('removeEntry deletes the joined path and busts the cache', async () => {
    mocked.deleteFile.mockResolvedValue(undefined)
    mocked.scanRoot.mockResolvedValue(scan([{ path: 'sub/a.mp4' }]))
    const dir = new HttpDirectoryHandle({ name: 'sub', relativePath: 'sub' })
    await collect(dir.values())
    await dir.removeEntry('a.mp4')
    expect(mocked.deleteFile).toHaveBeenCalledWith('sub/a.mp4')
    await collect(dir.values())
    expect(mocked.scanRoot).toHaveBeenCalledTimes(2)
  })

  it('resolve returns [] when descendant is the directory itself', async () => {
    const dir = new HttpDirectoryHandle({ name: 'sub', relativePath: 'sub' })
    await expect(dir.resolve(dir)).resolves.toEqual([])
  })

  it('resolve returns path segments for a descendant', async () => {
    const root = new HttpDirectoryHandle({ name: 'root', relativePath: '' })
    const child = new HttpFileHandle({ name: 'b.mp4', relativePath: 'sub/deep/b.mp4', size: 0, lastModified: 0 })
    await expect(root.resolve(child)).resolves.toEqual(['sub', 'deep', 'b.mp4'])
  })

  it('resolve returns null for a non-descendant', async () => {
    const dir = new HttpDirectoryHandle({ name: 'sub', relativePath: 'sub' })
    const other = new HttpFileHandle({ name: 'c.mp4', relativePath: 'other/c.mp4', size: 0, lastModified: 0 })
    await expect(dir.resolve(other)).resolves.toBeNull()
  })

  it('permission queries reflect a denied (unreachable) server', async () => {
    vi.useFakeTimers()
    vi.advanceTimersByTime(200_000)
    try {
      mocked.getInfo.mockRejectedValue(new Error('down'))
      const dir = new HttpDirectoryHandle({ name: 'sub', relativePath: 'sub' })
      await expect(dir.queryPermission()).resolves.toBe('denied')
      await expect(dir.requestPermission()).resolves.toBe('denied')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('buildRootHandle', () => {
  it('builds an empty-relativePath root handle with the given name', async () => {
    const root = await buildRootHandle('My Media')
    expect(root).toBeInstanceOf(HttpDirectoryHandle)
    expect(root.name).toBe('My Media')
    expect(root.relativePath).toBe('')
  })
})

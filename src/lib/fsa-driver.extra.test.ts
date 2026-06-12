import { describe, it, expect, vi, afterEach } from 'vitest'
import { FsaDriver, isFileSystemAccessSupported } from './fsa-driver'
import type { TagPayload } from './storage-driver'

const INDEX_FILE = 'index.json'
const INDEX_TMP_FILE = 'index.json.tmp'
const INDEX_BAK_FILE = 'index.json.bak'

function emptyPayload(): TagPayload {
  return { tags: {}, videoLoops: {}, tagCreatedAt: {}, lastReviewed: {} }
}

function notFound(): DOMException {
  return new DOMException('not found', 'NotFoundError')
}

// ───────────────────────────────────────────────────────────────────────────
// In-memory FSA-shaped directory mock
// ───────────────────────────────────────────────────────────────────────────

type FakeFile = { content: string; supportsMove: boolean }

/**
 * Builds a fake FileSystemDirectoryHandle backed by a Map of file contents.
 * Files created via getFileHandle({create:true}) get a createWritable() that
 * appends to a buffer, plus an optional move() to exercise the rename path.
 */
function makeDirHandle(
  initial: Record<string, string> = {},
  opts: { supportsMove?: boolean } = {}
) {
  const supportsMove = opts.supportsMove ?? true
  const files = new Map<string, FakeFile>()
  for (const [name, content] of Object.entries(initial)) {
    files.set(name, { content, supportsMove })
  }
  const removeEntry = vi.fn(async (name: string) => {
    if (!files.has(name)) throw notFound()
    files.delete(name)
  })

  function makeFileHandle(name: string) {
    const handle: Record<string, unknown> = {
      name,
      kind: 'file',
      getFile: async () => {
        const f = files.get(name)
        if (!f) throw notFound()
        return { text: async () => f.content }
      },
      createWritable: vi.fn(async () => {
        let buf = ''
        return {
          write: vi.fn(async (data: string) => {
            buf += data
          }),
          close: vi.fn(async () => {
            const existing = files.get(name)
            files.set(name, {
              content: buf,
              supportsMove: existing?.supportsMove ?? supportsMove,
            })
          }),
        }
      }),
    }
    if (supportsMove) {
      handle.move = vi.fn(async (newName: string) => {
        const f = files.get(name)
        if (!f) throw notFound()
        files.delete(name)
        files.set(newName, f)
      })
    }
    return handle
  }

  const dir = {
    name: 'root',
    kind: 'directory',
    getFileHandle: vi.fn(
      async (name: string, options?: { create?: boolean }) => {
        if (!files.has(name) && !options?.create) throw notFound()
        if (!files.has(name) && options?.create) {
          files.set(name, { content: '', supportsMove })
        }
        return makeFileHandle(name)
      }
    ),
    removeEntry,
  } as unknown as FileSystemDirectoryHandle

  return { dir, files, removeEntry }
}

// ───────────────────────────────────────────────────────────────────────────

describe('isFileSystemAccessSupported', () => {
  const orig = (globalThis as { window?: unknown }).window

  afterEach(() => {
    if (orig === undefined) delete (globalThis as { window?: unknown }).window
    else (globalThis as { window?: unknown }).window = orig
  })

  it('returns false when window is undefined', () => {
    delete (globalThis as { window?: unknown }).window
    expect(isFileSystemAccessSupported()).toBe(false)
  })

  it('returns false when showDirectoryPicker is missing', () => {
    ;(globalThis as { window?: unknown }).window = {}
    expect(isFileSystemAccessSupported()).toBe(false)
  })

  it('returns true when showDirectoryPicker is present', () => {
    ;(globalThis as { window?: unknown }).window = { showDirectoryPicker: () => {} }
    expect(isFileSystemAccessSupported()).toBe(true)
  })
})

describe('FsaDriver.connect', () => {
  const orig = (globalThis as { window?: unknown }).window
  afterEach(() => {
    if (orig === undefined) delete (globalThis as { window?: unknown }).window
    else (globalThis as { window?: unknown }).window = orig
  })

  it('throws when the API is unsupported', async () => {
    delete (globalThis as { window?: unknown }).window
    await expect(FsaDriver.connect()).rejects.toThrow(/not supported/)
  })

  it('picks a folder and builds a driver from the handle', async () => {
    const handle = { name: 'mydir' } as unknown as FileSystemDirectoryHandle
    const showDirectoryPicker = vi.fn(async () => handle)
    ;(globalThis as { window?: unknown }).window = { showDirectoryPicker }
    const driver = await FsaDriver.connect()
    expect(driver.rootName).toBe('mydir')
    expect(showDirectoryPicker).toHaveBeenCalledWith({
      mode: 'readwrite',
      id: 'degu-root',
    })
  })
})

describe('FsaDriver.reconnect', () => {
  it('returns a driver when permission is already granted', async () => {
    const handle = {
      name: 'r',
      queryPermission: vi.fn(async () => 'granted'),
      requestPermission: vi.fn(),
    } as unknown as FileSystemDirectoryHandle
    const driver = await FsaDriver.reconnect(handle)
    expect(driver.rootName).toBe('r')
    expect(
      (handle as unknown as { requestPermission: ReturnType<typeof vi.fn> })
        .requestPermission
    ).not.toHaveBeenCalled()
  })

  it('requests permission when not granted, then succeeds', async () => {
    const handle = {
      name: 'r',
      queryPermission: vi.fn(async () => 'prompt'),
      requestPermission: vi.fn(async () => 'granted'),
    } as unknown as FileSystemDirectoryHandle
    const driver = await FsaDriver.reconnect(handle)
    expect(driver.rootName).toBe('r')
  })

  it('throws when permission is denied', async () => {
    const handle = {
      name: 'r',
      queryPermission: vi.fn(async () => 'prompt'),
      requestPermission: vi.fn(async () => 'denied'),
    } as unknown as FileSystemDirectoryHandle
    await expect(FsaDriver.reconnect(handle)).rejects.toThrow(/denied/)
  })
})

describe('FsaDriver.loadTags', () => {
  it('returns an empty payload when index.json is missing', async () => {
    const { dir } = makeDirHandle({})
    const driver = FsaDriver.forTesting(dir)
    const payload = await driver.loadTags()
    expect(payload).toEqual(emptyPayload())
  })

  it('returns an empty payload when the file is blank', async () => {
    const { dir } = makeDirHandle({ [INDEX_FILE]: '   \n ' })
    const driver = FsaDriver.forTesting(dir)
    expect(await driver.loadTags()).toEqual(emptyPayload())
  })

  it('parses a stored index payload', async () => {
    const onDisk = JSON.stringify({
      'a/b.mp4': ['fun'],
      __degu: { version: 1 },
    })
    const { dir } = makeDirHandle({ [INDEX_FILE]: onDisk })
    const driver = FsaDriver.forTesting(dir)
    const payload = await driver.loadTags()
    expect(payload.tags['a/b.mp4']).toEqual(['fun'])
  })

  it('throws SyntaxError on corrupt JSON', async () => {
    const { dir } = makeDirHandle({ [INDEX_FILE]: '{ not json' })
    const driver = FsaDriver.forTesting(dir)
    await expect(driver.loadTags()).rejects.toThrow(SyntaxError)
  })

  it('rethrows non-NotFound errors from getFileHandle', async () => {
    const dir = {
      name: 'root',
      getFileHandle: vi.fn(async () => {
        throw new DOMException('boom', 'SecurityError')
      }),
    } as unknown as FileSystemDirectoryHandle
    const driver = FsaDriver.forTesting(dir)
    await expect(driver.loadTags()).rejects.toThrow('boom')
  })
})

describe('FsaDriver.saveTags', () => {
  it('writes tmp then moves it over index.json (rename path)', async () => {
    const { dir, files } = makeDirHandle({}, { supportsMove: true })
    const driver = FsaDriver.forTesting(dir)
    await driver.saveTags(emptyPayload())
    expect(files.has(INDEX_FILE)).toBe(true)
    expect(files.has(INDEX_TMP_FILE)).toBe(false)
    const written = JSON.parse(files.get(INDEX_FILE)!.content)
    expect(written).toBeTypeOf('object')
  })

  it('falls back to bak/replace when move is unavailable (no prior index)', async () => {
    const { dir, files } = makeDirHandle({}, { supportsMove: false })
    const driver = FsaDriver.forTesting(dir)
    await driver.saveTags(emptyPayload())
    expect(files.has(INDEX_FILE)).toBe(true)
    expect(files.has(INDEX_TMP_FILE)).toBe(false)
    // No prior index → no bak left behind.
    expect(files.has(INDEX_BAK_FILE)).toBe(false)
  })

  it('fallback path backs up an existing index then writes the new one', async () => {
    const prior = JSON.stringify({ 'old.mp4': ['x'], __degu: {} })
    const { dir, files } = makeDirHandle(
      { [INDEX_FILE]: prior },
      { supportsMove: false }
    )
    const driver = FsaDriver.forTesting(dir)
    const payload: TagPayload = {
      tags: { 'new.mp4': ['y'] },
      videoLoops: {},
      tagCreatedAt: {},
      lastReviewed: {},
    }
    await driver.saveTags(payload)
    // New index is in place; bak cleaned up after success.
    expect(files.has(INDEX_FILE)).toBe(true)
    expect(files.has(INDEX_BAK_FILE)).toBe(false)
    const written = JSON.parse(files.get(INDEX_FILE)!.content)
    expect(written['new.mp4']).toBeDefined()
  })

  it('falls back when move() rejects', async () => {
    const { dir, files } = makeDirHandle({}, { supportsMove: true })
    // Force the move to reject so tryRenameTmpOverIndex returns false.
    const origGet = dir.getFileHandle as unknown as (
      name: string,
      o?: { create?: boolean }
    ) => Promise<Record<string, unknown>>
    ;(dir as unknown as { getFileHandle: unknown }).getFileHandle = vi.fn(
      async (name: string, o?: { create?: boolean }) => {
        const fh = await origGet(name, o)
        if (name === INDEX_TMP_FILE) {
          fh.move = vi.fn(async () => {
            throw new Error('move failed')
          })
        }
        return fh
      }
    )
    const driver = FsaDriver.forTesting(dir)
    await driver.saveTags(emptyPayload())
    expect(files.has(INDEX_FILE)).toBe(true)
    expect(files.has(INDEX_TMP_FILE)).toBe(false)
  })
})

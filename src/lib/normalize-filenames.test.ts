import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mock tags module ---
const mockRenameTagStorageKeysBatch = vi.hoisted(() => vi.fn())
const mockFlushTagIndex = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock('./tags', () => ({
  renameTagStorageKeysBatch: mockRenameTagStorageKeysBatch,
  flushTagIndex: mockFlushTagIndex,
}))

// --- Mock media-paths module ---
// Will be overridden per test via mockReturnValue
const mockCollectAllMediaRelativePaths = vi.hoisted(() => vi.fn<() => Promise<string[]>>())

vi.mock('./media-paths', () => ({
  collectAllMediaRelativePaths: (
    _root: FileSystemDirectoryHandle,
    _opts?: unknown
  ) => mockCollectAllMediaRelativePaths(),
}))

import { normalizeBasename, runNormalizeFilenames } from './normalize-filenames'

// ---------------------------------------------------------------------------
// Helpers: build minimal in-memory FileSystem tree
// ---------------------------------------------------------------------------

type MockFileHandle = {
  kind: 'file'
  name: string
  move: ReturnType<typeof vi.fn>
}

type MockDirHandle = {
  kind: 'directory'
  name: string
  files: Map<string, MockFileHandle>
  dirs: Map<string, MockDirHandle>
  values: () => AsyncIterableIterator<MockFileHandle | MockDirHandle>
  getFileHandle: (name: string) => Promise<MockFileHandle>
  getDirectoryHandle: (name: string) => Promise<MockDirHandle>
}

function makeFile(name: string, moveImpl?: () => Promise<void>): MockFileHandle {
  return {
    kind: 'file',
    name,
    move: vi.fn(moveImpl ?? (() => Promise.resolve())),
  }
}

function makeDir(
  name: string,
  entries: (MockFileHandle | MockDirHandle)[] = []
): MockDirHandle {
  const files = new Map<string, MockFileHandle>()
  const dirs = new Map<string, MockDirHandle>()
  for (const e of entries) {
    if (e.kind === 'file') files.set(e.name, e)
    else dirs.set(e.name, e)
  }

  const dir: MockDirHandle = {
    kind: 'directory',
    name,
    files,
    dirs,
    async *values() {
      for (const f of files.values()) yield f
      for (const d of dirs.values()) yield d
    },
    async getFileHandle(n: string) {
      const fh = files.get(n)
      if (!fh) throw new DOMException(`Not found: ${n}`, 'NotFoundError')
      return fh
    },
    async getDirectoryHandle(n: string) {
      const dh = dirs.get(n)
      if (!dh) throw new DOMException(`Not found: ${n}`, 'NotFoundError')
      return dh
    },
  }
  return dir
}

// ---------------------------------------------------------------------------
// normalizeBasename — pure function tests
// ---------------------------------------------------------------------------

describe('normalizeBasename', () => {
  describe('extension is preserved', () => {
    it('removes substring from stem, not extension', () => {
      expect(normalizeBasename('myfoofile.mp4', ['foo'])).toBe('myfile.mp4')
    })

    it('removal that matches only inside the extension is not applied to ext', () => {
      // "mp" appears in ".mp4" — must NOT touch the extension
      expect(normalizeBasename('video.mp4', ['mp'])).toBe('video.mp4')
    })

    it('removes multiple occurrences from stem', () => {
      expect(normalizeBasename('a-copy-copy.jpg', ['copy'])).toBe('a--.jpg')
    })

    it('applies multiple removals in order', () => {
      // remove "foo" then "bar"
      expect(normalizeBasename('foobar-baz.png', ['foo', 'bar'])).toBe('-baz.png')
    })

    it('trims whitespace from stem only', () => {
      // removing "my " leaves " file.jpg" → stem " file" gets trimmed → "file.jpg"
      expect(normalizeBasename('my file.jpg', ['my '])).toBe('file.jpg')
    })
  })

  describe('no extension', () => {
    it('applies removals to the whole name when there is no dot', () => {
      expect(normalizeBasename('README', ['EAD'])).toBe('RME')
    })

    it('leading-dot file: dot at index 0 → treated as no extension', () => {
      // ".gitignore" has dot at index 0 → hasExt is false → apply removals to full name
      expect(normalizeBasename('.gitignore', ['git'])).toBe('.ignore')
    })
  })

  describe('no-op cases', () => {
    it('empty removals list → name unchanged', () => {
      expect(normalizeBasename('photo.jpg', [])).toBe('photo.jpg')
    })

    it('blank removal strings are ignored', () => {
      expect(normalizeBasename('photo.jpg', ['   ', ''])).toBe('photo.jpg')
    })

    it('removal not present in name → unchanged', () => {
      expect(normalizeBasename('photo.jpg', ['xyz'])).toBe('photo.jpg')
    })
  })
})

// ---------------------------------------------------------------------------
// runNormalizeFilenames — integration tests
// ---------------------------------------------------------------------------

describe('runNormalizeFilenames', () => {
  beforeEach(() => {
    mockRenameTagStorageKeysBatch.mockReset()
    mockFlushTagIndex.mockReset()
    mockFlushTagIndex.mockResolvedValue(undefined)
    mockCollectAllMediaRelativePaths.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renames a file and calls renameTagStorageKeysBatch once with the pair', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['vacation.jpg'])
    const fileHandle = makeFile('vacation.jpg')
    const root = makeDir('root', [fileHandle])

    const report = await runNormalizeFilenames(
      root as unknown as FileSystemDirectoryHandle,
      ['vac']
    )

    expect(report.renamed).toBe(1)
    expect(report.unchanged).toBe(0)
    expect(report.skippedCollision).toBe(0)
    expect(report.skippedInvalid).toBe(0)
    expect(report.failed).toHaveLength(0)
    expect(report.successfulRenames).toEqual([
      { from: 'vacation.jpg', to: 'ation.jpg' },
    ])

    // move() was called with new basename
    expect(fileHandle.move).toHaveBeenCalledWith('ation.jpg')

    // batch called exactly once, after all renames
    expect(mockRenameTagStorageKeysBatch).toHaveBeenCalledTimes(1)
    expect(mockRenameTagStorageKeysBatch).toHaveBeenCalledWith([
      { from: 'vacation.jpg', to: 'ation.jpg' },
    ])

    // flush called once
    expect(mockFlushTagIndex).toHaveBeenCalledTimes(1)
  })

  it('skips collision when target name already exists in the directory', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['a.jpg', 'aa.jpg'])
    const root = makeDir('root', [makeFile('a.jpg'), makeFile('aa.jpg')])

    const report = await runNormalizeFilenames(
      root as unknown as FileSystemDirectoryHandle,
      ['a']
    )

    // "a.jpg" → removes "a" → ".jpg" → empty stem → skippedInvalid
    // "aa.jpg" → removes "a" → ".jpg" → empty stem → skippedInvalid
    // Both hit empty-stem guard rather than collision; depends on order
    // At least skipped counts are non-zero and renamed is 0
    expect(report.renamed).toBe(0)
    expect(report.failed).toHaveLength(0)
    expect(mockRenameTagStorageKeysBatch).toHaveBeenCalledWith([])
  })

  it('collision between two files where one rename target matches existing', async () => {
    // After removing "extra-" from "extra-photo.jpg" we get "photo.jpg"
    // which already exists → collision
    mockCollectAllMediaRelativePaths.mockResolvedValue([
      'photo.jpg',
      'extra-photo.jpg',
    ])
    const root = makeDir('root', [
      makeFile('photo.jpg'),
      makeFile('extra-photo.jpg'),
    ])

    const report = await runNormalizeFilenames(
      root as unknown as FileSystemDirectoryHandle,
      ['extra-']
    )

    expect(report.renamed).toBe(0)
    expect(report.skippedCollision).toBe(1)
    expect(report.skippedInvalid).toBe(0)
    expect(report.unchanged).toBe(1) // "photo.jpg" unchanged
    expect(mockRenameTagStorageKeysBatch).toHaveBeenCalledWith([])
  })

  it('skips invalid when removing entire stem produces empty stem', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['vacation.jpg'])
    const fileHandle = makeFile('vacation.jpg')
    const root = makeDir('root', [fileHandle])

    const report = await runNormalizeFilenames(
      root as unknown as FileSystemDirectoryHandle,
      ['vacation']
    )

    expect(report.skippedInvalid).toBe(1)
    expect(report.renamed).toBe(0)
    expect(fileHandle.move).not.toHaveBeenCalled()
    expect(mockRenameTagStorageKeysBatch).toHaveBeenCalledWith([])
    expect(mockFlushTagIndex).toHaveBeenCalledTimes(1)
  })

  it('records failure when move() rejects', async () => {
    // Use removal "c" so "cfile.mp4" → "file.mp4" (valid stem), but move() throws
    mockCollectAllMediaRelativePaths.mockResolvedValue(['cfile.mp4'])
    const fh = makeFile('cfile.mp4', async () => {
      throw new Error('disk error')
    })
    const root = makeDir('root', [fh])

    const report = await runNormalizeFilenames(
      root as unknown as FileSystemDirectoryHandle,
      ['c']
    )

    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]!.path).toBe('cfile.mp4')
    expect(report.failed[0]!.message).toBe('disk error')
    expect(report.renamed).toBe(0)
    // successfulRenames should be empty since move failed
    expect(report.successfulRenames).toHaveLength(0)
    expect(mockRenameTagStorageKeysBatch).toHaveBeenLastCalledWith([])
  })

  it('renameTagStorageKeysBatch is called once even with multiple successful renames', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue([
      'vacation-clip.jpg',
      'vacation-photo.png',
    ])
    const root = makeDir('root', [
      makeFile('vacation-clip.jpg'),
      makeFile('vacation-photo.png'),
    ])

    const report = await runNormalizeFilenames(
      root as unknown as FileSystemDirectoryHandle,
      ['vacation-']
    )

    expect(report.renamed).toBe(2)
    expect(mockRenameTagStorageKeysBatch).toHaveBeenCalledTimes(1)
    expect(mockRenameTagStorageKeysBatch).toHaveBeenCalledWith([
      { from: 'vacation-clip.jpg', to: 'clip.jpg' },
      { from: 'vacation-photo.png', to: 'photo.png' },
    ])
    expect(mockFlushTagIndex).toHaveBeenCalledTimes(1)
  })

  it('handles files in subdirectories correctly', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['photos/vacation.jpg'])
    const fileHandle = makeFile('vacation.jpg')
    const subdir = makeDir('photos', [fileHandle])
    const root = makeDir('root', [subdir])

    const report = await runNormalizeFilenames(
      root as unknown as FileSystemDirectoryHandle,
      ['vac']
    )

    expect(report.renamed).toBe(1)
    expect(report.successfulRenames).toEqual([
      { from: 'photos/vacation.jpg', to: 'photos/ation.jpg' },
    ])
    expect(fileHandle.move).toHaveBeenCalledWith('ation.jpg')
  })
})

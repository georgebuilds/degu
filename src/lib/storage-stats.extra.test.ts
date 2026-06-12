import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the tag index lookup so we control which files appear tagged.
vi.mock('./tags.ts', () => ({
  getTagsCached: vi.fn((_key: string, _cache: Map<string, string[]>) => [] as string[]),
}))

import { getTagsCached } from './tags.ts'
import { computeStorageStats } from './storage-stats.ts'

// Per-test tag map, applied through the mocked getTagsCached.
const tagsByKey = new Map<string, string[]>()

// ── In-memory FSA shims ──────────────────────────────────────────────────────

function makeFileHandle(name: string, size: number, opts?: { throwOnGetFile?: boolean }): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => {
      if (opts?.throwOnGetFile) throw new Error('unreadable')
      return { size } as unknown as File
    },
  } as unknown as FileSystemFileHandle
}

function makeDirHandle(
  name: string,
  entries: (FileSystemFileHandle | FileSystemDirectoryHandle)[]
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const e of entries) yield e
    },
  } as unknown as FileSystemDirectoryHandle
}

beforeEach(() => {
  tagsByKey.clear()
  vi.mocked(getTagsCached).mockImplementation(
    (key: string, _cache: Map<string, string[]>) => tagsByKey.get(key) ?? []
  )
})

afterEach(() => {
  tagsByKey.clear()
})

describe('computeStorageStats', () => {
  it('aggregates totals, kinds, and extensions across a flat directory', async () => {
    const root = makeDirHandle('root', [
      makeFileHandle('photo.jpg', 100),
      makeFileHandle('clip.mp4', 500),
      makeFileHandle('notes.txt', 30),
    ])
    const report = await computeStorageStats(root)
    expect(report.totalBytes).toBe(630)
    expect(report.fileCount).toBe(3)
    expect(report.byKind.image).toBe(100)
    expect(report.byKind.video).toBe(500)
    expect(report.byKind.other).toBe(30)
    // Extensions sorted by bytes descending.
    expect(report.byExtension).toEqual([
      { ext: '.mp4', bytes: 500 },
      { ext: '.jpg', bytes: 100 },
      { ext: '.txt', bytes: 30 },
    ])
  })

  it('labels extensionless files as (no extension)', async () => {
    const root = makeDirHandle('root', [makeFileHandle('README', 10)])
    const report = await computeStorageStats(root)
    expect(report.byExtension).toEqual([{ ext: '(no extension)', bytes: 10 }])
  })

  it('recurses into subdirectories and counts dirs visited via progress', async () => {
    const sub = makeDirHandle('sub', [makeFileHandle('inner.png', 200)])
    const root = makeDirHandle('root', [makeFileHandle('outer.jpg', 100), sub])
    const progress: { filesScanned: number; dirsVisited: number; bytesSoFar: number }[] = []
    const report = await computeStorageStats(root, { onProgress: p => progress.push(p) })
    expect(report.totalBytes).toBe(300)
    expect(report.fileCount).toBe(2)
    // Final emit reflects one directory visited.
    const last = progress.at(-1)!
    expect(last.dirsVisited).toBe(1)
    expect(last.filesScanned).toBe(2)
    expect(last.bytesSoFar).toBe(300)
  })

  it('aggregates bytes by tag and tracks untagged bytes', async () => {
    tagsByKey.set('a.jpg', ['vacation', 'beach'])
    tagsByKey.set('b.jpg', ['vacation'])
    // c.jpg has no tags entry -> untagged
    const root = makeDirHandle('root', [
      makeFileHandle('a.jpg', 100),
      makeFileHandle('b.jpg', 50),
      makeFileHandle('c.jpg', 25),
    ])
    const report = await computeStorageStats(root)
    expect(report.untaggedBytes).toBe(25)
    expect(report.byTag).toEqual([
      { tag: 'vacation', bytes: 150 },
      { tag: 'beach', bytes: 100 },
    ])
  })

  it('ignores blank/whitespace tags when aggregating', async () => {
    tagsByKey.set('a.jpg', ['  ', '', 'real'])
    const root = makeDirHandle('root', [makeFileHandle('a.jpg', 40)])
    const report = await computeStorageStats(root)
    expect(report.byTag).toEqual([{ tag: 'real', bytes: 40 }])
    expect(report.untaggedBytes).toBe(0)
  })

  it('skips files whose getFile() throws without counting them', async () => {
    const root = makeDirHandle('root', [
      makeFileHandle('ok.jpg', 100),
      makeFileHandle('broken.jpg', 999, { throwOnGetFile: true }),
    ])
    const report = await computeStorageStats(root)
    expect(report.fileCount).toBe(1)
    expect(report.totalBytes).toBe(100)
  })

  it('emits progress every N files honoring progressEvery', async () => {
    const root = makeDirHandle('root', [
      makeFileHandle('f0.jpg', 1),
      makeFileHandle('f1.jpg', 1),
      makeFileHandle('f2.jpg', 1),
      makeFileHandle('f3.jpg', 1),
      makeFileHandle('f4.jpg', 1),
    ])
    const progress: number[] = []
    await computeStorageStats(root, {
      progressEvery: 2,
      onProgress: p => progress.push(p.filesScanned),
    })
    expect(progress).toEqual([2, 4, 5])
  })

})

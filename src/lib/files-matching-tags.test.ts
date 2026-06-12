import { beforeEach, describe, expect, it, vi } from 'vitest'

// Map of relative path -> tags. The mocked getTagsCached reads this.
let tagsByPath: Record<string, string[]> = {}

vi.mock('./tags.ts', () => ({
  getTagsCached: vi.fn((key: string, cache: Map<string, string[]>) => {
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const tags = tagsByPath[key] ?? []
    cache.set(key, tags)
    return tags
  }),
}))

import { findFilesWithAllTags, findUntaggedFiles } from './files-matching-tags.ts'

function makeFileHandle(
  name: string,
  size = 100,
  lastModified = 7
): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: vi.fn(async () => ({ size, lastModified }) as unknown as File),
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
  tagsByPath = {}
})

describe('findFilesWithAllTags', () => {
  it('returns empty result immediately for empty requiredTags', async () => {
    const root = makeDirHandle('root', [makeFileHandle('a.jpg')])
    const result = await findFilesWithAllTags(root, [])
    expect(result.files).toEqual([])
    expect(result.fileTags).toEqual({})
  })

  it('returns files that have every required tag', async () => {
    tagsByPath = {
      'a.jpg': ['cat', 'cute'],
      'b.jpg': ['cat'],
      'c.jpg': ['cat', 'cute', 'extra'],
    }
    const root = makeDirHandle('root', [
      makeFileHandle('a.jpg'),
      makeFileHandle('b.jpg'),
      makeFileHandle('c.jpg'),
    ])
    const result = await findFilesWithAllTags(root, ['cat', 'cute'])
    expect(result.files.map(f => f.name)).toEqual(['a.jpg', 'c.jpg'])
    expect(result.fileTags['a.jpg']).toEqual(['cat', 'cute'])
    expect(result.fileTags['c.jpg']).toEqual(['cat', 'cute', 'extra'])
    expect(result.fileTags['b.jpg']).toBeUndefined()
  })

  it('skips unsupported media files even when tagged', async () => {
    tagsByPath = { 'notes.txt': ['cat'], 'pic.jpg': ['cat'] }
    const root = makeDirHandle('root', [
      makeFileHandle('notes.txt'),
      makeFileHandle('pic.jpg'),
    ])
    const result = await findFilesWithAllTags(root, ['cat'])
    expect(result.files.map(f => f.name)).toEqual(['pic.jpg'])
  })

  it('recurses into subdirectories and prefixes relative paths', async () => {
    tagsByPath = {
      'top.jpg': ['fav'],
      'sub/deep.png': ['fav'],
      'sub/nested/x.mp4': ['fav'],
    }
    const nested = makeDirHandle('nested', [makeFileHandle('x.mp4')])
    const sub = makeDirHandle('sub', [makeFileHandle('deep.png'), nested])
    const root = makeDirHandle('root', [makeFileHandle('top.jpg'), sub])
    const result = await findFilesWithAllTags(root, ['fav'])
    expect(result.files.map(f => f.relativePath)).toEqual([
      'sub/deep.png',
      'sub/nested/x.mp4',
      'top.jpg',
    ])
    // tagStorageKey mirrors relativePath
    expect(result.files.every(f => f.tagStorageKey === f.relativePath)).toBe(
      true
    )
  })

  it('populates size and lastModified from the file handle', async () => {
    tagsByPath = { 'a.jpg': ['t'] }
    const root = makeDirHandle('root', [makeFileHandle('a.jpg', 555, 1234)])
    const result = await findFilesWithAllTags(root, ['t'])
    expect(result.files[0]).toMatchObject({
      kind: 'file',
      size: 555,
      lastModified: 1234,
    })
  })

  it('returns empty files when nothing matches', async () => {
    tagsByPath = { 'a.jpg': ['other'] }
    const root = makeDirHandle('root', [makeFileHandle('a.jpg')])
    const result = await findFilesWithAllTags(root, ['cat'])
    expect(result.files).toEqual([])
    expect(result.fileTags).toEqual({})
  })

  it('rejects with AbortError when signal is already aborted', async () => {
    const root = makeDirHandle('root', [makeFileHandle('a.jpg')])
    const controller = new AbortController()
    controller.abort()
    await expect(
      findFilesWithAllTags(root, ['cat'], controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('aborts mid-iteration during directory traversal', async () => {
    tagsByPath = { 'a.jpg': ['cat'], 'b.jpg': ['cat'] }
    const controller = new AbortController()
    const root = makeDirHandle('root', [])
    // values() aborts after yielding the first entry
    ;(root as { values: () => AsyncIterable<unknown> }).values =
      async function* () {
        yield makeFileHandle('a.jpg')
        controller.abort()
        yield makeFileHandle('b.jpg')
      }
    await expect(
      findFilesWithAllTags(root, ['cat'], controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('findUntaggedFiles', () => {
  it('returns only media files with no tags', async () => {
    tagsByPath = { 'tagged.jpg': ['cat'] }
    const root = makeDirHandle('root', [
      makeFileHandle('tagged.jpg'),
      makeFileHandle('untagged.png'),
    ])
    const result = await findUntaggedFiles(root)
    expect(result.files.map(f => f.name)).toEqual(['untagged.png'])
    expect(result.fileTags).toEqual({ 'untagged.png': [] })
  })

  it('skips unsupported files', async () => {
    const root = makeDirHandle('root', [
      makeFileHandle('readme.txt'),
      makeFileHandle('clip.webm'),
    ])
    const result = await findUntaggedFiles(root)
    expect(result.files.map(f => f.name)).toEqual(['clip.webm'])
  })

  it('recurses and returns sorted relative paths', async () => {
    tagsByPath = { 'sub/y.jpg': ['has'] }
    const sub = makeDirHandle('sub', [
      makeFileHandle('y.jpg'),
      makeFileHandle('z.jpg'),
    ])
    const root = makeDirHandle('root', [makeFileHandle('a.jpg'), sub])
    const result = await findUntaggedFiles(root)
    expect(result.files.map(f => f.relativePath)).toEqual([
      'a.jpg',
      'sub/z.jpg',
    ])
    expect(result.fileTags).toEqual({ 'a.jpg': [], 'sub/z.jpg': [] })
  })

  it('returns empty when every file is tagged', async () => {
    tagsByPath = { 'a.jpg': ['x'], 'b.jpg': ['y'] }
    const root = makeDirHandle('root', [
      makeFileHandle('a.jpg'),
      makeFileHandle('b.jpg'),
    ])
    const result = await findUntaggedFiles(root)
    expect(result.files).toEqual([])
    expect(result.fileTags).toEqual({})
  })

  it('rejects with AbortError when signal is already aborted', async () => {
    const root = makeDirHandle('root', [makeFileHandle('a.jpg')])
    const controller = new AbortController()
    controller.abort()
    await expect(
      findUntaggedFiles(root, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

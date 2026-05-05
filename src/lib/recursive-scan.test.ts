import { describe, expect, it, vi } from 'vitest'

vi.mock('./tags.ts', () => ({
  getTagsCached: vi.fn((_key: string, _cache: Map<string, string[]>) => []),
}))

import { scanRecursive } from './recursive-scan.ts'

// Minimal in-memory FileSystem shims
function makeFileHandle(name: string): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () =>
      ({
        size: 100,
        lastModified: 0,
      } as unknown as File),
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

describe('scanRecursive', () => {
  it('empty query returns empty result immediately', async () => {
    const root = makeDirHandle('root', [makeFileHandle('vacation.jpg')])
    const stack = [root]
    const result = await scanRecursive(root, '', stack)
    expect(result.dirs).toEqual([])
    expect(result.files).toEqual([])
    expect(result.fileTags).toEqual({})
  })

  it('whitespace-only query returns empty result', async () => {
    const root = makeDirHandle('root', [makeFileHandle('photo.jpg')])
    const stack = [root]
    const result = await scanRecursive(root, '   ', stack)
    expect(result.dirs).toEqual([])
    expect(result.files).toEqual([])
  })

  it('folder name match adds to dirs array', async () => {
    const subdir = makeDirHandle('photos', [])
    const root = makeDirHandle('root', [subdir])
    const stack = [root]
    const result = await scanRecursive(root, 'photo', stack)
    expect(result.dirs).toHaveLength(1)
    expect(result.dirs[0]!.name).toBe('photos')
    expect(result.dirs[0]!.relativePath).toBe('photos')
  })

  it('file name match (case-insensitive) adds to files array', async () => {
    const root = makeDirHandle('root', [makeFileHandle('MyVacation.jpg')])
    const stack = [root]
    const result = await scanRecursive(root, 'vacation', stack)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.name).toBe('MyVacation.jpg')
  })

  it('file names of unsupported extensions are not included even if they match the query', async () => {
    const root = makeDirHandle('root', [
      makeFileHandle('notes.txt'),
      makeFileHandle('archive.zip'),
      makeFileHandle('document.pdf'),
      makeFileHandle('valid.jpg'),
    ])
    const stack = [root]
    // All filenames contain something we can search for
    const result = await scanRecursive(root, 'notes', stack)
    expect(result.files).toHaveLength(0)

    const result2 = await scanRecursive(root, 'valid', stack)
    expect(result2.files).toHaveLength(1)
    expect(result2.files[0]!.name).toBe('valid.jpg')
  })

  it('AbortSignal: aborting before calling causes promise to reject with AbortError', async () => {
    const root = makeDirHandle('root', [makeFileHandle('photo.jpg')])
    const stack = [root]
    const controller = new AbortController()
    controller.abort()
    await expect(
      scanRecursive(root, 'photo', stack, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('tagStorageKey is prefixed with subdirectory path when stack has depth > 1', async () => {
    const srcHandle = makeDirHandle('src', [])
    // Rebuild lib to actually have file
    const libWithFile = makeDirHandle('lib', [makeFileHandle('utils.jpg')])
    const srcWithLib = makeDirHandle('src', [libWithFile])
    const root = makeDirHandle('root', [srcWithLib])

    // stack: [root, src, lib] — simulates navigating into root/src/lib
    const stack = [root, srcHandle, libWithFile]
    const result = await scanRecursive(libWithFile, 'utils', stack)
    expect(result.files).toHaveLength(1)
    // The tagStorageKey should be prefixed with "src/lib/"
    expect(result.files[0]!.tagStorageKey).toBe('src/lib/utils.jpg')
  })

  it('fileTags record is populated for each matched file', async () => {
    const root = makeDirHandle('root', [makeFileHandle('clip.mp4')])
    const stack = [root]
    const result = await scanRecursive(root, 'clip', stack)
    expect(result.files).toHaveLength(1)
    const key = result.files[0]!.tagStorageKey
    expect(result.fileTags).toHaveProperty(key)
    expect(result.fileTags[key]).toEqual([])
  })

  it('returns dirs and files sorted by relativePath', async () => {
    const root = makeDirHandle('root', [
      makeDirHandle('betafolder', []),
      makeDirHandle('alphafolder', []),
      makeFileHandle('b_video.mp4'),
      makeFileHandle('a_image.jpg'),
    ])
    const stack = [root]
    // 'folder' matches betafolder and alphafolder dirs; 'image' and 'video' differ
    const resultDirs = await scanRecursive(root, 'folder', stack)
    expect(resultDirs.dirs.map(d => d.name)).toEqual(['alphafolder', 'betafolder'])

    const resultFiles = await scanRecursive(root, 'image', stack)
    expect(resultFiles.files.map(f => f.name)).toEqual(['a_image.jpg'])
  })
})

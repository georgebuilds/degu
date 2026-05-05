import { describe, expect, it, vi } from 'vitest'
import {
  collectAllMediaRelativePaths,
  collectUntaggedMediaRelativePaths,
} from './media-paths.ts'

// Minimal in-memory FileSystem shims
function file(name: string): FileSystemFileHandle {
  return { kind: 'file', name } as unknown as FileSystemFileHandle
}

function dir(
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

describe('collectAllMediaRelativePaths', () => {
  it('returns only supported media files and ignores unsupported extensions', async () => {
    const root = dir('root', [
      file('photo.jpg'),
      file('clip.mp4'),
      file('readme.txt'),
      file('script.exe'),
    ])
    const result = await collectAllMediaRelativePaths(root)
    expect(result.sort()).toEqual(['clip.mp4', 'photo.jpg'])
  })

  it('returns paths joined with / for nested folders', async () => {
    const root = dir('root', [
      dir('photos', [file('a.jpg'), file('b.png')]),
      file('top.webm'),
    ])
    const result = await collectAllMediaRelativePaths(root)
    expect(result.sort()).toEqual(['photos/a.jpg', 'photos/b.png', 'top.webm'])
  })

  it('handles deeply nested folders', async () => {
    const root = dir('root', [
      dir('a', [dir('b', [file('deep.gif')])]),
    ])
    const result = await collectAllMediaRelativePaths(root)
    expect(result).toEqual(['a/b/deep.gif'])
  })

  it('populates stats when stats arg is passed', async () => {
    const root = dir('root', [
      dir('sub', [file('img.jpg')]),
      file('video.mp4'),
    ])
    const stats = { mediaFiles: 0, dirsVisited: 0 }
    await collectAllMediaRelativePaths(root, { stats })
    // root dir + sub dir
    expect(stats.dirsVisited).toBe(2)
    // img.jpg + video.mp4
    expect(stats.mediaFiles).toBe(2)
  })

  it('calls emitCollect callback when collecting', async () => {
    const root = dir('root', [file('a.jpg'), file('b.mp4')])
    const emitCollect = vi.fn()
    const stats = { mediaFiles: 0, dirsVisited: 0 }
    await collectAllMediaRelativePaths(root, { stats, emitCollect })
    // At minimum called once for dir visit and once per media file
    expect(emitCollect.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('returns empty array for an empty directory', async () => {
    const root = dir('root', [])
    const result = await collectAllMediaRelativePaths(root)
    expect(result).toEqual([])
  })
})

describe('collectUntaggedMediaRelativePaths', () => {
  it('returns only media not in taggedUnion', async () => {
    const root = dir('root', [
      file('tagged.jpg'),
      file('untagged.jpg'),
      file('also.mp4'),
    ])
    const taggedUnion = new Set(['tagged.jpg'])
    const result = await collectUntaggedMediaRelativePaths(root, taggedUnion)
    expect(result).toContain('untagged.jpg')
    expect(result).toContain('also.mp4')
    expect(result).not.toContain('tagged.jpg')
  })

  it('result is sorted ascending by localeCompare', async () => {
    const root = dir('root', [
      file('zebra.jpg'),
      file('apple.mp4'),
      file('mango.png'),
    ])
    const result = await collectUntaggedMediaRelativePaths(root, new Set())
    expect(result).toEqual(['apple.mp4', 'mango.png', 'zebra.jpg'])
  })

  it('excludes tagged files in nested paths', async () => {
    const root = dir('root', [
      dir('sub', [file('tagged.jpg'), file('free.webm')]),
    ])
    const taggedUnion = new Set(['sub/tagged.jpg'])
    const result = await collectUntaggedMediaRelativePaths(root, taggedUnion)
    expect(result).toEqual(['sub/free.webm'])
  })

  it('returns empty when all files are tagged', async () => {
    const root = dir('root', [file('a.jpg'), file('b.mp4')])
    const taggedUnion = new Set(['a.jpg', 'b.mp4'])
    const result = await collectUntaggedMediaRelativePaths(root, taggedUnion)
    expect(result).toEqual([])
  })

  it('ignores unsupported files even when not in taggedUnion', async () => {
    const root = dir('root', [file('doc.txt'), file('img.jpg')])
    const result = await collectUntaggedMediaRelativePaths(root, new Set())
    expect(result).toEqual(['img.jpg'])
  })
})

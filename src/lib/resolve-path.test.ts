import { describe, expect, it, vi } from 'vitest'

import {
  resolveParentDirectoryAndFileName,
  resolvePathToFileListItem,
} from './resolve-path.ts'

function makeFileHandle(
  name: string,
  size = 100,
  lastModified = 42
): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: vi.fn(async () => ({ size, lastModified }) as unknown as File),
  } as unknown as FileSystemFileHandle
}

function makeDirHandle(
  name: string,
  dirs: Record<string, FileSystemDirectoryHandle> = {},
  files: Record<string, FileSystemFileHandle> = {}
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    getDirectoryHandle: vi.fn(async (childName: string) => {
      const child = dirs[childName]
      if (!child) throw new DOMException('no dir', 'NotFoundError')
      return child
    }),
    getFileHandle: vi.fn(async (childName: string) => {
      const child = files[childName]
      if (!child) throw new DOMException('no file', 'NotFoundError')
      return child
    }),
  } as unknown as FileSystemDirectoryHandle
}

describe('resolvePathToFileListItem', () => {
  it('resolves a top-level file', async () => {
    const fh = makeFileHandle('photo.jpg', 200, 99)
    const root = makeDirHandle('root', {}, { 'photo.jpg': fh })
    const item = await resolvePathToFileListItem(root, 'photo.jpg')
    expect(item).toEqual({
      kind: 'file',
      name: 'photo.jpg',
      tagStorageKey: 'photo.jpg',
      relativePath: 'photo.jpg',
      handle: fh,
      size: 200,
      lastModified: 99,
    })
  })

  it('resolves a nested file by walking directories', async () => {
    const fh = makeFileHandle('app.php', 7, 3)
    const libDir = makeDirHandle('lib', {}, { 'app.php': fh })
    const srcDir = makeDirHandle('src', { lib: libDir })
    const root = makeDirHandle('root', { src: srcDir })
    const item = await resolvePathToFileListItem(root, 'src/lib/app.php')
    expect(item.name).toBe('app.php')
    expect(item.relativePath).toBe('src/lib/app.php')
    expect(item.tagStorageKey).toBe('src/lib/app.php')
    expect(item.handle).toBe(fh)
    expect(root.getDirectoryHandle).toHaveBeenCalledWith('src')
    expect(srcDir.getDirectoryHandle).toHaveBeenCalledWith('lib')
    expect(libDir.getFileHandle).toHaveBeenCalledWith('app.php')
  })

  it('ignores leading/trailing/duplicate slashes', async () => {
    const fh = makeFileHandle('a.png')
    const sub = makeDirHandle('sub', {}, { 'a.png': fh })
    const root = makeDirHandle('root', { sub })
    const item = await resolvePathToFileListItem(root, '/sub//a.png/')
    expect(item.name).toBe('a.png')
    expect(item.handle).toBe(fh)
  })

  it('throws on an empty path', async () => {
    const root = makeDirHandle('root')
    await expect(resolvePathToFileListItem(root, '')).rejects.toThrow(
      'Empty path'
    )
    await expect(resolvePathToFileListItem(root, '///')).rejects.toThrow(
      'Empty path'
    )
  })

  it('propagates errors for a missing directory', async () => {
    const root = makeDirHandle('root', {})
    await expect(
      resolvePathToFileListItem(root, 'nope/file.jpg')
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('propagates errors for a missing file', async () => {
    const root = makeDirHandle('root', {}, {})
    await expect(
      resolvePathToFileListItem(root, 'missing.jpg')
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})

describe('resolveParentDirectoryAndFileName', () => {
  it('returns the root as parent for a top-level file', async () => {
    const root = makeDirHandle('root')
    const { parent, fileName } = await resolveParentDirectoryAndFileName(
      root,
      'photo.jpg'
    )
    expect(parent).toBe(root)
    expect(fileName).toBe('photo.jpg')
    expect(root.getDirectoryHandle).not.toHaveBeenCalled()
  })

  it('walks to the parent directory of a nested file', async () => {
    const libDir = makeDirHandle('lib')
    const srcDir = makeDirHandle('src', { lib: libDir })
    const root = makeDirHandle('root', { src: srcDir })
    const { parent, fileName } = await resolveParentDirectoryAndFileName(
      root,
      'src/lib/app.php'
    )
    expect(parent).toBe(libDir)
    expect(fileName).toBe('app.php')
    expect(root.getDirectoryHandle).toHaveBeenCalledWith('src')
    expect(srcDir.getDirectoryHandle).toHaveBeenCalledWith('lib')
  })

  it('ignores empty segments from extra slashes', async () => {
    const sub = makeDirHandle('sub')
    const root = makeDirHandle('root', { sub })
    const { parent, fileName } = await resolveParentDirectoryAndFileName(
      root,
      '/sub//a.png'
    )
    expect(parent).toBe(sub)
    expect(fileName).toBe('a.png')
  })

  it('throws on an empty path', async () => {
    const root = makeDirHandle('root')
    await expect(
      resolveParentDirectoryAndFileName(root, '')
    ).rejects.toThrow('Empty path')
  })

  it('propagates errors for a missing intermediate directory', async () => {
    const root = makeDirHandle('root', {})
    await expect(
      resolveParentDirectoryAndFileName(root, 'gone/file.jpg')
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})

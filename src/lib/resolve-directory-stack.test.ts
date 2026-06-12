import { describe, expect, it, vi } from 'vitest'

import { resolveDirectoryStack } from './resolve-directory-stack.ts'

function makeDirHandle(
  name: string,
  children: Record<string, FileSystemDirectoryHandle> = {}
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    getDirectoryHandle: vi.fn(async (childName: string) => {
      const child = children[childName]
      if (!child) {
        throw new DOMException('not found', 'NotFoundError')
      }
      return child
    }),
  } as unknown as FileSystemDirectoryHandle
}

describe('resolveDirectoryStack', () => {
  it('returns a stack with only the root for empty segments', async () => {
    const root = makeDirHandle('root')
    const stack = await resolveDirectoryStack(root, [])
    expect(stack).toHaveLength(1)
    expect(stack[0]).toBe(root)
  })

  it('walks one level deep', async () => {
    const photos = makeDirHandle('photos')
    const root = makeDirHandle('root', { photos })
    const stack = await resolveDirectoryStack(root, ['photos'])
    expect(stack).toHaveLength(2)
    expect(stack[0]).toBe(root)
    expect(stack[1]).toBe(photos)
  })

  it('walks multiple nested levels in order', async () => {
    const lib = makeDirHandle('lib')
    const src = makeDirHandle('src', { lib })
    const root = makeDirHandle('root', { src })
    const stack = await resolveDirectoryStack(root, ['src', 'lib'])
    expect(stack.map(h => h.name)).toEqual(['root', 'src', 'lib'])
    expect(stack[1]).toBe(src)
    expect(stack[2]).toBe(lib)
  })

  it('calls getDirectoryHandle on the current top of the stack', async () => {
    const lib = makeDirHandle('lib')
    const src = makeDirHandle('src', { lib })
    const root = makeDirHandle('root', { src })
    await resolveDirectoryStack(root, ['src', 'lib'])
    expect(root.getDirectoryHandle).toHaveBeenCalledWith('src')
    expect(src.getDirectoryHandle).toHaveBeenCalledWith('lib')
    expect(lib.getDirectoryHandle).not.toHaveBeenCalled()
  })

  it('propagates errors from getDirectoryHandle (missing segment)', async () => {
    const root = makeDirHandle('root', {})
    await expect(
      resolveDirectoryStack(root, ['missing'])
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})

import { describe, expect, it } from 'vitest'
import {
  tagStorageKeyForFileInStack,
  tagStorageKeyFromRootAndPathUnderCurrentDir,
} from './tag-key'

function h(name: string): FileSystemDirectoryHandle {
  return { name } as FileSystemDirectoryHandle
}

describe('tagStorageKeyForFileInStack', () => {
  it('builds path from root + nested dirs + file', () => {
    const stack = [h('root'), h('photos'), h('2024')]
    expect(tagStorageKeyForFileInStack(stack, 'img.jpg')).toBe(
      'photos/2024/img.jpg'
    )
  })

  it('uses only file name when stack is root only', () => {
    const stack = [h('root')]
    expect(tagStorageKeyForFileInStack(stack, 'readme.txt')).toBe('readme.txt')
  })
})

describe('tagStorageKeyFromRootAndPathUnderCurrentDir', () => {
  it('joins base from stack with relative path', () => {
    const stack = [h('root'), h('a'), h('b')]
    expect(tagStorageKeyFromRootAndPathUnderCurrentDir(stack, 'c/d.png')).toBe(
      'a/b/c/d.png'
    )
  })

  it('returns base when relative path is empty', () => {
    const stack = [h('root'), h('x')]
    expect(tagStorageKeyFromRootAndPathUnderCurrentDir(stack, '')).toBe('x')
  })

  it('returns only relative path when at root of key (no stack prefix)', () => {
    const stack = [h('root')]
    expect(tagStorageKeyFromRootAndPathUnderCurrentDir(stack, 'only.mp4')).toBe(
      'only.mp4'
    )
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { aggregateTagsUnderRoot } from './root-tag-index'

function makeFileHandle(name: string): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: vi.fn(async () => ({ size: 1, lastModified: 0 }) as unknown as File),
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

describe('aggregateTagsUnderRoot', () => {
  it('returns empty result for an empty tree', async () => {
    const root = makeDirHandle('root', [])
    const result = await aggregateTagsUnderRoot(root)
    expect(result.counts).toEqual([])
    expect(result.tagToPaths.size).toBe(0)
  })

  it('counts tags and builds an inverted index sorted alphabetically', async () => {
    tagsByPath = {
      'a.jpg': ['cat', 'dog'],
      'b.jpg': ['cat'],
      'c.jpg': ['dog'],
    }
    const root = makeDirHandle('root', [
      makeFileHandle('a.jpg'),
      makeFileHandle('b.jpg'),
      makeFileHandle('c.jpg'),
    ])
    const result = await aggregateTagsUnderRoot(root)
    expect(result.counts).toEqual([
      { tag: 'cat', count: 2 },
      { tag: 'dog', count: 2 },
    ])
    expect([...result.tagToPaths.get('cat')!].sort()).toEqual([
      'a.jpg',
      'b.jpg',
    ])
    expect([...result.tagToPaths.get('dog')!].sort()).toEqual([
      'a.jpg',
      'c.jpg',
    ])
  })

  it('aggregates across nested subdirectories using full relative paths', async () => {
    tagsByPath = {
      'top.jpg': ['fav'],
      'sub/deep.png': ['fav', 'rare'],
    }
    const sub = makeDirHandle('sub', [makeFileHandle('deep.png')])
    const root = makeDirHandle('root', [makeFileHandle('top.jpg'), sub])
    const result = await aggregateTagsUnderRoot(root)
    expect(result.counts).toEqual([
      { tag: 'fav', count: 2 },
      { tag: 'rare', count: 1 },
    ])
    expect([...result.tagToPaths.get('fav')!].sort()).toEqual([
      'sub/deep.png',
      'top.jpg',
    ])
  })

  it('ignores files with no tags', async () => {
    tagsByPath = { 'a.jpg': ['x'] }
    const root = makeDirHandle('root', [
      makeFileHandle('a.jpg'),
      makeFileHandle('b.jpg'),
    ])
    const result = await aggregateTagsUnderRoot(root)
    expect(result.counts).toEqual([{ tag: 'x', count: 1 }])
  })

  it('emits a final collect progress event and tags progress', async () => {
    tagsByPath = { 'a.jpg': ['t'] }
    const root = makeDirHandle('root', [makeFileHandle('a.jpg')])
    const events: string[] = []
    const result = await aggregateTagsUnderRoot(root, {
      onProgress: p => {
        events.push(p.phase)
      },
    })
    expect(events).toContain('collect')
    // tags progress fires on the final path (done === total)
    expect(events).toContain('tags')
    expect(result.counts).toEqual([{ tag: 't', count: 1 }])
  })

  it('emits a tags progress event every 64 files and on the last file', async () => {
    const entries: FileSystemFileHandle[] = []
    for (let i = 0; i < 130; i++) {
      const name = `f${String(i).padStart(3, '0')}.jpg`
      tagsByPath[name] = ['t']
      entries.push(makeFileHandle(name))
    }
    const root = makeDirHandle('root', entries)
    const tagsEvents: { done: number; total: number }[] = []
    await aggregateTagsUnderRoot(root, {
      onProgress: p => {
        if (p.phase === 'tags') tagsEvents.push({ done: p.done, total: p.total })
      },
    })
    // 64, 128, and 130 (final) => three tags events
    expect(tagsEvents.map(e => e.done)).toEqual([64, 128, 130])
    expect(tagsEvents.every(e => e.total === 130)).toBe(true)
  })

  it('works without an onProgress callback', async () => {
    tagsByPath = { 'a.jpg': ['t'] }
    const root = makeDirHandle('root', [makeFileHandle('a.jpg')])
    const result = await aggregateTagsUnderRoot(root, {})
    expect(result.counts).toEqual([{ tag: 't', count: 1 }])
  })
})

import { describe, expect, it } from 'vitest'
import {
  pathsMatchingAllTags,
  relativePathsUntagged,
  tagsSelectableWithFilter,
  unionOfTaggedPaths,
} from './tag-filter-paths.ts'

describe('tagsSelectableWithFilter', () => {
  it('includes all tags when filter is empty', () => {
    const map = new Map<string, Set<string>>([
      ['a', new Set(['p1'])],
      ['b', new Set(['p2'])],
    ])
    const sel = tagsSelectableWithFilter(map, [], ['a', 'b'])
    expect([...sel].sort()).toEqual(['a', 'b'])
  })

  it('always includes active filter tags', () => {
    const map = new Map<string, Set<string>>([
      ['x', new Set(['p1'])],
      ['y', new Set(['p2'])],
    ])
    const sel = tagsSelectableWithFilter(map, ['x', 'y'], ['x', 'y', 'z'])
    expect(sel.has('x')).toBe(true)
    expect(sel.has('y')).toBe(true)
  })

  it('includes only tags that co-occur on some file in the filter corpus', () => {
    const map = new Map<string, Set<string>>([
      ['vacation', new Set(['a.mp4', 'b.mp4'])],
      ['beach', new Set(['a.mp4'])],
      ['mountain', new Set(['c.mp4'])],
    ])
    const sel = tagsSelectableWithFilter(map, ['vacation'], [
      'vacation',
      'beach',
      'mountain',
    ])
    expect(sel.has('vacation')).toBe(true)
    expect(sel.has('beach')).toBe(true)
    expect(sel.has('mountain')).toBe(false)
  })

  it('narrows with multiple filter tags', () => {
    const map = new Map<string, Set<string>>([
      ['a', new Set(['p1', 'p2'])],
      ['b', new Set(['p1'])],
      ['c', new Set(['p2'])],
    ])
    const corpus = pathsMatchingAllTags(map, ['a', 'b'])
    expect(corpus).toEqual(['p1'])
    const sel = tagsSelectableWithFilter(map, ['a', 'b'], ['a', 'b', 'c'])
    expect(sel.has('c')).toBe(false)
  })
})

describe('unionOfTaggedPaths', () => {
  it('merges all paths from every tag set', () => {
    const map = new Map<string, Set<string>>([
      ['a', new Set(['p1', 'p2'])],
      ['b', new Set(['p2', 'p3'])],
    ])
    const u = unionOfTaggedPaths(map)
    expect([...u].sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('returns empty set for empty map', () => {
    expect(unionOfTaggedPaths(new Map()).size).toBe(0)
  })
})

describe('relativePathsUntagged', () => {
  it('keeps paths not in the tagged union', () => {
    const tagged = new Set(['a.jpg', 'b.jpg'])
    const all = ['a.jpg', 'c.jpg', 'd.png']
    expect(relativePathsUntagged(tagged, all)).toEqual(['c.jpg', 'd.png'])
  })

  it('sorts output by localeCompare', () => {
    const tagged = new Set<string>()
    expect(relativePathsUntagged(tagged, ['z', 'a', 'm'])).toEqual([
      'a',
      'm',
      'z',
    ])
  })
})

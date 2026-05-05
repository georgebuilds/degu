import { describe, expect, it } from 'vitest'
import { countsFromTagToPaths, patchTagIndexAfterEdit } from './patch-tag-index'

describe('patchTagIndexAfterEdit', () => {
  it('adds path to new tags', () => {
    const m = new Map<string, Set<string>>()
    patchTagIndexAfterEdit(m, 'p/a.jpg', [], ['x', 'y'])
    expect(m.get('x')?.has('p/a.jpg')).toBe(true)
    expect(m.get('y')?.has('p/a.jpg')).toBe(true)
  })

  it('removes path from dropped tags and prunes empty sets', () => {
    const m = new Map<string, Set<string>>([
      ['a', new Set(['p1.jpg'])],
      ['b', new Set(['p1.jpg'])],
    ])
    patchTagIndexAfterEdit(m, 'p1.jpg', ['a', 'b'], ['a'])
    expect(m.get('a')?.has('p1.jpg')).toBe(true)
    expect(m.has('b')).toBe(false)
  })

  it('does not duplicate path when tag unchanged', () => {
    const m = new Map<string, Set<string>>([['t', new Set(['f.png'])]])
    patchTagIndexAfterEdit(m, 'f.png', ['t'], ['t'])
    expect(m.get('t')?.size).toBe(1)
  })
})

describe('countsFromTagToPaths', () => {
  it('sorts tags and reports counts', () => {
    const m = new Map<string, Set<string>>([
      ['zebra', new Set(['a', 'b'])],
      ['alpha', new Set(['c'])],
    ])
    expect(countsFromTagToPaths(m)).toEqual([
      { tag: 'alpha', count: 1 },
      { tag: 'zebra', count: 2 },
    ])
  })
})

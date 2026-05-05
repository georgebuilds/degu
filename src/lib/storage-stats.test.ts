import { describe, expect, it } from 'vitest'
import { sortBytesMapDescending } from './storage-stats.ts'

describe('sortBytesMapDescending', () => {
  it('sorts by bytes descending', () => {
    const m = new Map([
      ['a', 10],
      ['b', 100],
      ['c', 50],
    ])
    expect(sortBytesMapDescending(m).map(x => x.key)).toEqual(['b', 'c', 'a'])
  })

  it('handles empty map', () => {
    expect(sortBytesMapDescending(new Map())).toEqual([])
  })
})

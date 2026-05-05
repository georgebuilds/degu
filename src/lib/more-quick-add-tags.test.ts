import { describe, expect, it } from 'vitest'
import {
  buildMoreQuickAddTagsMulti,
  buildMoreQuickAddTagsSingle,
  moreQuickAddTagsMulti,
  moreQuickAddTagsSingle,
} from './more-quick-add-tags'

describe('moreQuickAddTagsSingle', () => {
  it('returns tags not applied and not in recent strip', () => {
    expect(
      moreQuickAddTagsSingle(
        ['a', 'b', 'c', 'd'],
        ['a', 'b'],
        ['c']
      )
    ).toEqual(['d'])
  })

  it('returns empty when everything is applied or shown as recent', () => {
    expect(
      moreQuickAddTagsSingle(['a', 'b'], ['a'], ['b'])
    ).toEqual([])
  })

  it('excludes tags already on the file even if not in recent strip', () => {
    expect(moreQuickAddTagsSingle(['x', 'y'], [], ['x'])).toEqual(['y'])
  })

  it('excludes tags in recent strip even when not yet applied', () => {
    expect(moreQuickAddTagsSingle(['a', 'b'], ['a'], [])).toEqual(['b'])
  })

  it('returns empty when allKnownSorted is empty', () => {
    expect(moreQuickAddTagsSingle([], ['a'], [])).toEqual([])
  })

  it('sorts alphabetically regardless of allKnown input order', () => {
    expect(
      moreQuickAddTagsSingle(['zebra', 'apple'], [], [])
    ).toEqual(['apple', 'zebra'])
  })
})

describe('moreQuickAddTagsMulti', () => {
  it('includes tag if any target lacks it, excluding recent strip', () => {
    expect(
      moreQuickAddTagsMulti(
        ['a', 'b', 'c'],
        ['a'],
        ['k1', 'k2'],
        { k1: ['b'], k2: ['b'] }
      )
    ).toEqual(['c'])
  })

  it('excludes tag when every target has it', () => {
    expect(
      moreQuickAddTagsMulti(['a'], [], ['k1'], { k1: ['a'] })
    ).toEqual([])
  })

  it('returns no tags when targetKeys is empty (vacuous every)', () => {
    expect(
      moreQuickAddTagsMulti(['a', 'b'], [], [], { k1: [] })
    ).toEqual([])
  })

  it('includes tag when one of two files lacks it', () => {
    expect(
      moreQuickAddTagsMulti(
        ['shared', 'only-a'],
        [],
        ['ka', 'kb'],
        { ka: ['shared'], kb: [] }
      )
    ).toEqual(['only-a', 'shared'])
  })

  it('treats missing fileTags entry as no tags on that file', () => {
    expect(
      moreQuickAddTagsMulti(['t1'], [], ['k1', 'k2'], { k1: [] })
    ).toEqual(['t1'])
  })

  it('excludes tags listed in recent strip', () => {
    expect(
      moreQuickAddTagsMulti(['r', 'extra'], ['r'], ['k'], { k: [] })
    ).toEqual(['extra'])
  })
})

describe('buildMoreQuickAddTagsSingle', () => {
  it('puts overflow recent tags in More when visible strip is smaller than stored recent', () => {
    expect(
      buildMoreQuickAddTagsSingle(
        ['a', 'b', 'c', 'd', 'e'],
        ['a', 'b', 'c', 'd', 'e'],
        [],
        4
      )
    ).toEqual(['e'])
  })

  it('orders overflow recent before other index tags', () => {
    expect(
      buildMoreQuickAddTagsSingle(
        ['z', 'e', 'y'],
        ['a', 'b', 'c', 'd', 'e'],
        [],
        4
      )
    ).toEqual(['e', 'y', 'z'])
  })
})

describe('buildMoreQuickAddTagsMulti', () => {
  it('includes overflow recent when not in visible strip', () => {
    expect(
      buildMoreQuickAddTagsMulti(
        ['a', 'b', 'c', 'd'],
        ['a', 'b', 'c', 'd'],
        3,
        ['k'],
        { k: [] }
      )
    ).toEqual(['d'])
  })
})

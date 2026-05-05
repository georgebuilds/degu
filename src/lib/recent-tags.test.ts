import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRecentTags, recordTagApplied, subscribeRecentTags } from './recent-tags'

const STORAGE_KEY = 'degu_recent_tags'

describe('recent-tags', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    const ls = {
      getItem: (k: string) => (k in store ? store[k]! : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      clear: () => {
        store = {}
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length
      },
    } as Storage
    vi.stubGlobal('localStorage', ls)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns empty when nothing stored', () => {
    expect(getRecentTags()).toEqual([])
  })

  it('recordTagApplied prepends and dedupes', () => {
    recordTagApplied('a')
    recordTagApplied('b')
    recordTagApplied('a')
    expect(getRecentTags()).toEqual(['a', 'b'])
  })

  it('trims and skips empty', () => {
    recordTagApplied('  x  ')
    recordTagApplied('   ')
    expect(getRecentTags()).toEqual(['x'])
  })

  it('keeps newest first and drops oldest when MAX is reached', () => {
    for (let i = 1; i <= 9; i++) {
      recordTagApplied(String(i))
    }
    // MAX=60, so all 9 fit; newest first
    expect(getRecentTags()).toEqual(['9', '8', '7', '6', '5', '4', '3', '2', '1'])
  })

  it('getRecentTags tolerates invalid JSON', () => {
    store[STORAGE_KEY] = 'not-json'
    expect(getRecentTags()).toEqual([])
  })

  it('getRecentTags filters non-strings in array', () => {
    store[STORAGE_KEY] = JSON.stringify(['ok', 1, null, 'z'])
    expect(getRecentTags()).toEqual(['ok', 'z'])
  })

  describe('subscribeRecentTags', () => {
    it('fires listener when recordTagApplied is called', () => {
      const fn = vi.fn()
      subscribeRecentTags(fn)
      recordTagApplied('hello')
      expect(fn).toHaveBeenCalledTimes(1)
      recordTagApplied('world')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('unsubscribing prevents further calls', () => {
      const fn = vi.fn()
      const unsub = subscribeRecentTags(fn)
      recordTagApplied('first')
      expect(fn).toHaveBeenCalledTimes(1)
      unsub()
      recordTagApplied('second')
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })
})

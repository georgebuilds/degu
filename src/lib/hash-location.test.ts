import { describe, expect, it, vi } from 'vitest'
import { encodePathSegments, parseHashToSegments, stackHandlesToSegments } from './hash-location'

function h(name: string): FileSystemDirectoryHandle {
  return { name } as FileSystemDirectoryHandle
}

describe('encodePathSegments', () => {
  it('root is slash', () => {
    expect(encodePathSegments([])).toBe('/')
  })

  it('joins with slashes and encodes', () => {
    expect(encodePathSegments(['photos', 'a b'])).toBe('/photos/a%20b')
  })

  it('encodes unicode', () => {
    expect(encodePathSegments(['café'])).toBe('/caf%C3%A9')
  })
})

describe('stackHandlesToSegments', () => {
  it('drops root handle', () => {
    const stack = [h('root'), h('a'), h('b')]
    expect(stackHandlesToSegments(stack)).toEqual(['a', 'b'])
  })

  it('empty when only root', () => {
    expect(stackHandlesToSegments([h('root')])).toEqual([])
  })
})

describe('parseHashToSegments', () => {
  function withHash(hash: string, fn: () => void) {
    vi.stubGlobal('window', { location: { hash, pathname: '/', search: '' } })
    try {
      fn()
    } finally {
      vi.unstubAllGlobals()
    }
  }

  it('filters empty segments from double slashes', () => {
    withHash('#//foo', () => {
      expect(parseHashToSegments()).toEqual(['foo'])
    })
  })

  it('filters empty segments from internal double slashes', () => {
    withHash('#/a//b', () => {
      expect(parseHashToSegments()).toEqual(['a', 'b'])
    })
  })

  it('returns empty for root hash', () => {
    withHash('#/', () => {
      expect(parseHashToSegments()).toEqual([])
    })
  })

  it('returns segments for normal path', () => {
    withHash('#/photos/2024', () => {
      expect(parseHashToSegments()).toEqual(['photos', '2024'])
    })
  })
})

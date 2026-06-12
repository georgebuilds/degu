/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

let version = 0
const listeners = new Set<() => void>()

vi.mock('./tags', () => ({
  getTagIndexVersion: vi.fn(() => version),
  subscribeTagIndexVersion: vi.fn((fn: () => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }),
}))

import { useTagIndexVersion } from './use-tag-index-version'

function bump() {
  version++
  for (const fn of [...listeners]) fn()
}

afterEach(() => {
  version = 0
  listeners.clear()
  vi.clearAllMocks()
})

describe('useTagIndexVersion', () => {
  it('returns the current version on first render', () => {
    version = 5
    const { result } = renderHook(() => useTagIndexVersion())
    expect(result.current).toBe(5)
  })

  it('subscribes on mount', () => {
    renderHook(() => useTagIndexVersion())
    expect(listeners.size).toBe(1)
  })

  it('re-renders with the new version when the index version bumps', () => {
    const { result } = renderHook(() => useTagIndexVersion())
    expect(result.current).toBe(0)
    act(() => {
      bump()
    })
    expect(result.current).toBe(1)
    act(() => {
      bump()
    })
    expect(result.current).toBe(2)
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useTagIndexVersion())
    expect(listeners.size).toBe(1)
    unmount()
    expect(listeners.size).toBe(0)
  })
})

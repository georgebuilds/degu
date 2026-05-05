import { describe, expect, it, vi } from 'vitest'
import { mapWithConcurrency, throttle, throttleVoid } from './throttle'

describe('mapWithConcurrency', () => {
  it('maps all items with bounded concurrency', async () => {
    let active = 0
    let maxActive = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], async n => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise<void>(r => queueMicrotask(r))
      active--
      return n * 10
    }, 2)
    expect(results).toEqual([10, 20, 30, 40, 50])
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('returns empty array for empty input', async () => {
    const r = await mapWithConcurrency(
      [] as number[],
      async x => x,
      3
    )
    expect(r).toEqual([])
  })
})

describe('throttleVoid', () => {
  it('runs at most once per window', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = throttleVoid(fn, 100)
    t()
    t()
    t()
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})

describe('throttle', () => {
  it('passes latest arg when deferred', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t('a')
    t('b')
    t('c')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith('a')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('c')
    vi.useRealTimers()
  })
})

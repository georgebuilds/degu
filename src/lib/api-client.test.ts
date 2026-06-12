import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withDefaultTimeout } from './api-client'

describe('withDefaultTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('aborts with a TimeoutError DOMException when the timeout fires', () => {
    const { signal, cancel } = withDefaultTimeout(undefined, 1000)
    expect(signal.aborted).toBe(false)

    vi.advanceTimersByTime(1000)

    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBeInstanceOf(DOMException)
    expect((signal.reason as DOMException).name).toBe('TimeoutError')
    cancel()
  })

  it('is immediately aborted with the caller reason if the caller signal is already aborted', () => {
    const ctrl = new AbortController()
    const reason = new Error('caller bailed')
    ctrl.abort(reason)

    const { signal, cancel } = withDefaultTimeout(ctrl.signal, 1000)

    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe(reason)
    cancel()
  })

  it('propagates a later caller abort to the combined signal', () => {
    const ctrl = new AbortController()
    const { signal, cancel } = withDefaultTimeout(ctrl.signal, 1000)
    expect(signal.aborted).toBe(false)

    const reason = new Error('caller aborted later')
    ctrl.abort(reason)

    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe(reason)
    cancel()
  })

  it('cancel() clears the timer so no abort fires after the timeout would elapse', () => {
    const { signal, cancel } = withDefaultTimeout(undefined, 1000)
    cancel()

    vi.advanceTimersByTime(5000)

    expect(signal.aborted).toBe(false)
  })
})

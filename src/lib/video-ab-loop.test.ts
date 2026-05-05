/** @vitest-environment happy-dom */
import { render } from '@testing-library/preact'
import { h } from 'preact'
import { useRef } from 'preact/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVideoABLoop } from './video-ab-loop'

// Helper: create a fake HTMLVideoElement with spied addEventListener/removeEventListener
function makeMockVideo() {
  const listeners: Record<string, EventListenerOrEventListenerObject[]> = {}
  const el = {
    currentTime: 0,
    duration: NaN,
    addEventListener: vi.fn((event: string, cb: EventListenerOrEventListenerObject) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    }),
    removeEventListener: vi.fn((event: string, cb: EventListenerOrEventListenerObject) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(l => l !== cb)
      }
    }),
  }
  return el
}

type LoopRange = { startSec: number; endSec: number } | null

// Wrapper component that wires up useVideoABLoop
function ABLoopWrapper({
  videoEl,
  loopRange,
}: {
  videoEl: HTMLVideoElement | null
  loopRange: LoopRange
}) {
  const ref = useRef<HTMLVideoElement | null>(videoEl)
  // Keep the ref pointing at the same element across renders
  ref.current = videoEl
  useVideoABLoop(ref, loopRange)
  return null
}

describe('useVideoABLoop', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not attach listeners when loopRange is null', () => {
    const video = makeMockVideo()
    render(
      h(ABLoopWrapper, {
        videoEl: video as unknown as HTMLVideoElement,
        loopRange: null,
      })
    )
    expect(video.addEventListener).not.toHaveBeenCalled()
  })

  it('attaches timeupdate and seeked listeners when loopRange is set', () => {
    const video = makeMockVideo()
    render(
      h(ABLoopWrapper, {
        videoEl: video as unknown as HTMLVideoElement,
        loopRange: { startSec: 1, endSec: 5 },
      })
    )
    expect(video.addEventListener).toHaveBeenCalledWith('timeupdate', expect.any(Function))
    expect(video.addEventListener).toHaveBeenCalledWith('seeked', expect.any(Function))
  })

  it('does NOT reattach listeners when re-rendered with a new object but same values', () => {
    const video = makeMockVideo()
    const { rerender } = render(
      h(ABLoopWrapper, {
        videoEl: video as unknown as HTMLVideoElement,
        loopRange: { startSec: 1, endSec: 2 },
      })
    )

    const addCallCount = video.addEventListener.mock.calls.length
    const removeCallCount = video.removeEventListener.mock.calls.length

    // Re-render with a brand new object literal but identical values
    rerender(
      h(ABLoopWrapper, {
        videoEl: video as unknown as HTMLVideoElement,
        loopRange: { startSec: 1, endSec: 2 },
      })
    )

    // No additional add/remove calls — deps didn't change
    expect(video.addEventListener.mock.calls.length).toBe(addCallCount)
    expect(video.removeEventListener.mock.calls.length).toBe(removeCallCount)
  })

  it('reattaches listeners when startSec changes', () => {
    const video = makeMockVideo()
    const { rerender } = render(
      h(ABLoopWrapper, {
        videoEl: video as unknown as HTMLVideoElement,
        loopRange: { startSec: 1, endSec: 5 },
      })
    )

    const addCallsBefore = video.addEventListener.mock.calls.length
    const removeCallsBefore = video.removeEventListener.mock.calls.length

    // Change startSec
    rerender(
      h(ABLoopWrapper, {
        videoEl: video as unknown as HTMLVideoElement,
        loopRange: { startSec: 2, endSec: 5 },
      })
    )

    // Listeners should have been removed and re-added once
    expect(video.removeEventListener.mock.calls.length).toBe(removeCallsBefore + 2)
    expect(video.addEventListener.mock.calls.length).toBe(addCallsBefore + 2)
  })
})

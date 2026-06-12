/** @vitest-environment happy-dom */
import { render } from '@testing-library/preact'
import { h } from 'preact'
import { useRef } from 'preact/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVideoABLoop, VIDEO_AB_LOOP_EPS } from './video-ab-loop'

/**
 * Mock video that records listeners so tests can fire them and observe the
 * clamp() side effects on currentTime.
 */
function makeMockVideo(init: { currentTime?: number; duration?: number } = {}) {
  const listeners: Record<string, Array<() => void>> = {}
  const el = {
    currentTime: init.currentTime ?? 0,
    duration: init.duration ?? NaN,
    addEventListener: vi.fn((event: string, cb: () => void) => {
      ;(listeners[event] ??= []).push(cb)
    }),
    removeEventListener: vi.fn(),
    fire(event: string) {
      for (const cb of listeners[event] ?? []) cb()
    },
  }
  return el
}

type LoopRange = { startSec: number; endSec: number } | null

function Wrapper({
  videoEl,
  loopRange,
}: {
  videoEl: HTMLVideoElement | null
  loopRange: LoopRange
}) {
  const ref = useRef<HTMLVideoElement | null>(videoEl)
  ref.current = videoEl
  useVideoABLoop(ref, loopRange)
  return null
}

function mount(video: ReturnType<typeof makeMockVideo>, loopRange: LoopRange) {
  return render(
    h(Wrapper, {
      videoEl: video as unknown as HTMLVideoElement,
      loopRange,
    })
  )
}

describe('useVideoABLoop clamp behaviour', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does nothing when the span is below the minimum epsilon', () => {
    const video = makeMockVideo({ currentTime: 0 })
    mount(video, { startSec: 1, endSec: 1 + VIDEO_AB_LOOP_EPS / 2 })
    // Span too small → effect returns early, no listeners.
    expect(video.addEventListener).not.toHaveBeenCalled()
  })

  it('snaps an out-of-range currentTime to start on mount (before start)', () => {
    const video = makeMockVideo({ currentTime: 0 })
    mount(video, { startSec: 2, endSec: 6 })
    expect(video.currentTime).toBe(2)
  })

  it('snaps to start on mount when currentTime is past the end window', () => {
    const video = makeMockVideo({ currentTime: 10 })
    mount(video, { startSec: 2, endSec: 6 })
    expect(video.currentTime).toBe(2)
  })

  it('does not move a currentTime already inside the window on mount', () => {
    const video = makeMockVideo({ currentTime: 3 })
    mount(video, { startSec: 2, endSec: 6 })
    expect(video.currentTime).toBe(3)
  })

  it('clamps back to start when timeupdate fires past the end', () => {
    const video = makeMockVideo({ currentTime: 3 })
    mount(video, { startSec: 2, endSec: 6 })
    video.currentTime = 6 // at end
    video.fire('timeupdate')
    expect(video.currentTime).toBe(2)
  })

  it('clamps forward to start when currentTime drifts before start', () => {
    const video = makeMockVideo({ currentTime: 3 })
    mount(video, { startSec: 2, endSec: 6 })
    video.currentTime = 0.5 // before start
    video.fire('seeked')
    expect(video.currentTime).toBe(2)
  })

  it('uses finite duration to cap the effective end', () => {
    // endSec beyond the clip's real duration; duration should cap it.
    const video = makeMockVideo({ currentTime: 5, duration: 4 })
    mount(video, { startSec: 1, endSec: 100 })
    // currentTime 5 >= effective end (4) - eps → snaps to start.
    video.fire('timeupdate')
    expect(video.currentTime).toBe(1)
  })

  it('ignores a non-positive/NaN duration and uses endSec directly', () => {
    const video = makeMockVideo({ currentTime: 3, duration: 0 })
    mount(video, { startSec: 2, endSec: 6 })
    video.currentTime = 5.99 // within eps of end=6
    video.fire('timeupdate')
    expect(video.currentTime).toBe(2)
  })

  it('clamps a negative start to 0', () => {
    const video = makeMockVideo({ currentTime: -5 })
    mount(video, { startSec: -3, endSec: 6 })
    // start = max(0, -3) = 0; currentTime -5 < 0 → set to 0.
    expect(video.currentTime).toBe(0)
  })
})

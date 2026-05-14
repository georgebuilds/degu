import type { RefObject } from 'preact'
import { useEffect } from 'preact/hooks'

/** Minimum span (seconds) for an A–B loop; matches preview / export validation. */
export const VIDEO_AB_LOOP_EPS = 0.04

/**
 * Keeps playback between startSec and endSec (jumps back at the end).
 * Pass `null` to disable (normal playback).
 */
export function useVideoABLoop(
  videoRef: RefObject<HTMLVideoElement | null>,
  loopRange: { startSec: number; endSec: number } | null
): void {
  useEffect(() => {
    const el = videoRef.current
    if (!el || loopRange === null) return
    const startSec = loopRange?.startSec ?? null
    const endSec = loopRange?.endSec ?? null
    if (startSec === null || endSec === null) return
    if (endSec - startSec < VIDEO_AB_LOOP_EPS) return

    const clamp = () => {
      const d = el.duration
      const end = Number.isFinite(d) && d > 0
        ? Math.min(endSec, d)
        : endSec
      const start = Math.max(0, startSec)
      const t = el.currentTime
      if (t < start) {
        el.currentTime = start
        return
      }
      if (t >= end - VIDEO_AB_LOOP_EPS) {
        el.currentTime = start
      }
    }

    const onTimeUpdate = () => clamp()
    const onSeeked = () => clamp()
    el.addEventListener('timeupdate', onTimeUpdate)
    el.addEventListener('seeked', onSeeked)
    if (el.currentTime < startSec || el.currentTime >= endSec - VIDEO_AB_LOOP_EPS) {
      el.currentTime = Math.max(0, startSec)
    }
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate)
      el.removeEventListener('seeked', onSeeked)
    }
  }, [videoRef, loopRange?.startSec ?? null, loopRange?.endSec ?? null])
}

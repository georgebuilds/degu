/**
 * Heuristic output size if bytes/sec were uniform (re-encode and stream-copy can differ).
 */
export function estimateTrimSavingsBytes(
  originalBytes: number,
  durationSec: number,
  startSec: number,
  endSec: number
): {
  keptSec: number
  estimatedOutputBytes: number
  estimatedSavingsBytes: number
} | null {
  if (
    !Number.isFinite(originalBytes) ||
    originalBytes <= 0 ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0
  ) {
    return null
  }
  let a = startSec
  let b = endSec
  if (a > b) [a, b] = [b, a]
  const keptSec = Math.max(0, b - a)
  if (keptSec <= 0) return null
  const trimRatio = Math.min(1, keptSec / durationSec)
  const estimatedOutputBytes = originalBytes * trimRatio
  const estimatedSavingsBytes = Math.max(0, originalBytes - estimatedOutputBytes)
  return { keptSec, estimatedOutputBytes, estimatedSavingsBytes }
}

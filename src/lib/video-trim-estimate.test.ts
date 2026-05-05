import { describe, expect, it } from 'vitest'
import { estimateTrimSavingsBytes } from './video-trim-estimate.ts'

describe('estimateTrimSavingsBytes', () => {
  it('returns proportional estimate for middle segment', () => {
    const r = estimateTrimSavingsBytes(1000, 100, 25, 75)
    expect(r).not.toBeNull()
    expect(r!.keptSec).toBe(50)
    expect(r!.estimatedOutputBytes).toBe(500)
    expect(r!.estimatedSavingsBytes).toBe(500)
  })

  it('returns null for invalid duration', () => {
    expect(estimateTrimSavingsBytes(100, 0, 0, 10)).toBeNull()
  })

  it('returns null when originalBytes is not positive', () => {
    expect(estimateTrimSavingsBytes(0, 10, 0, 5)).toBeNull()
    expect(estimateTrimSavingsBytes(-1, 10, 0, 5)).toBeNull()
  })

  it('returns null when kept segment length is zero', () => {
    expect(estimateTrimSavingsBytes(1000, 60, 10, 10)).toBeNull()
  })

  it('normalizes reversed start and end', () => {
    const r = estimateTrimSavingsBytes(1000, 100, 80, 30)
    expect(r).not.toBeNull()
    expect(r!.keptSec).toBe(50)
    expect(r!.estimatedOutputBytes).toBe(500)
  })

  it('caps trim ratio at 1 when kept segment exceeds duration', () => {
    const r = estimateTrimSavingsBytes(1000, 10, 0, 100)
    expect(r).not.toBeNull()
    expect(r!.keptSec).toBe(100)
    expect(r!.estimatedOutputBytes).toBe(1000)
    expect(r!.estimatedSavingsBytes).toBe(0)
  })

  it('returns null for non-finite inputs', () => {
    expect(estimateTrimSavingsBytes(NaN, 10, 0, 5)).toBeNull()
    expect(estimateTrimSavingsBytes(100, NaN, 0, 5)).toBeNull()
  })
})

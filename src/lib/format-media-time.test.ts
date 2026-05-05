import { describe, expect, it } from 'vitest'
import { formatMediaTime } from './format-media-time.ts'

describe('formatMediaTime', () => {
  it('formats 0 as 0:00', () => {
    expect(formatMediaTime(0)).toBe('0:00')
  })

  it('formats 30 as 0:30', () => {
    expect(formatMediaTime(30)).toBe('0:30')
  })

  it('formats 60 as 1:00', () => {
    expect(formatMediaTime(60)).toBe('1:00')
  })

  it('formats 125 as 2:05', () => {
    expect(formatMediaTime(125)).toBe('2:05')
  })

  it('formats 3600 as 1:00:00', () => {
    expect(formatMediaTime(3600)).toBe('1:00:00')
  })

  it('formats 3725 as 1:02:05', () => {
    expect(formatMediaTime(3725)).toBe('1:02:05')
  })

  it('floors fractional seconds (30.7 → 0:30)', () => {
    expect(formatMediaTime(30.7)).toBe('0:30')
  })

  it('returns 0:00 for negative values', () => {
    expect(formatMediaTime(-1)).toBe('0:00')
  })

  it('returns 0:00 for NaN', () => {
    expect(formatMediaTime(NaN)).toBe('0:00')
  })
})

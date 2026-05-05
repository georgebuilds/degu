import { describe, expect, it } from 'vitest'
import { FFMPEG_CORE_MT_VERSION, MAX_TRIM_INPUT_BYTES } from './video-trim-scope.ts'

describe('video-trim-scope', () => {
  it('exports a pinned ffmpeg core version string', () => {
    expect(FFMPEG_CORE_MT_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('sets max trim input to 512 MiB', () => {
    expect(MAX_TRIM_INPUT_BYTES).toBe(512 * 1024 * 1024)
  })
})

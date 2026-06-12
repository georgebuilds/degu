import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @ffmpeg/util (fetchFile imported dynamically) ─────────────────────
vi.mock('@ffmpeg/util', () => ({
  fetchFile: vi.fn(async (file: File) => new Uint8Array(file.size)),
}))

// ─── Mock the ffmpeg singleton loader from ffmpeg-trim ──────────────────────
const mockOn = vi.fn()
const mockOff = vi.fn()
const mockWriteFile = vi.fn(async () => {})
const mockExec = vi.fn(async () => 0)
const mockReadFile = vi.fn(async () => new Uint8Array([1, 2, 3, 4]))
const mockDeleteFile = vi.fn(async () => {})

let mockLoaded = true

const mockFFmpegInstance = {
  get loaded() {
    return mockLoaded
  },
  on: mockOn,
  off: mockOff,
  writeFile: mockWriteFile,
  exec: mockExec,
  readFile: mockReadFile,
  deleteFile: mockDeleteFile,
}

vi.mock('./ffmpeg-trim.ts', () => ({
  getLoadedFFmpeg: vi.fn(async () => mockFFmpegInstance),
}))

import {
  scrubFileWithFFmpeg,
  buildFFmpegScrubArgs,
  MAX_SCRUB_INPUT_BYTES,
  type ScrubAction,
} from './ffmpeg-scrub.ts'

function makeFile(name: string, sizeBytes = 16, type = 'video/mp4'): File {
  return new File([new Uint8Array(sizeBytes)], name, { type })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLoaded = true
  mockExec.mockResolvedValue(0)
  mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
  mockWriteFile.mockResolvedValue(undefined)
  mockDeleteFile.mockResolvedValue(undefined)
})

// ─── buildFFmpegScrubArgs (pure) ────────────────────────────────────────────

describe('buildFFmpegScrubArgs', () => {
  it('builds strip args with -map_metadata -1', () => {
    const args = buildFFmpegScrubArgs({ mode: 'strip' }, 'in.mp4', 'out.mp4')
    expect(args).toEqual([
      '-i', 'in.mp4',
      '-map_metadata', '-1', '-c', 'copy',
      'out.mp4',
    ])
  })

  it('builds modify args with -metadata key=value pairs', () => {
    const action: ScrubAction = {
      mode: 'modify',
      fields: [
        { key: 'title', value: 'My Title' },
        { key: 'comment', value: 'hi' },
      ],
    }
    const args = buildFFmpegScrubArgs(action, 'in.mp4', 'out.mp4')
    expect(args).toEqual([
      '-i', 'in.mp4',
      '-map_metadata', '0', '-c', 'copy',
      '-metadata', 'title=My Title',
      '-metadata', 'comment=hi',
      'out.mp4',
    ])
  })

  it('trims keys and skips empty/whitespace keys in modify', () => {
    const action: ScrubAction = {
      mode: 'modify',
      fields: [
        { key: '  spaced  ', value: 'v' },
        { key: '   ', value: 'ignored' },
        { key: '', value: 'also-ignored' },
      ],
    }
    const args = buildFFmpegScrubArgs(action, 'in', 'out')
    expect(args).toContain('spaced=v')
    expect(args.filter(a => a === '-metadata')).toHaveLength(1)
  })
})

// ─── scrubFileWithFFmpeg ────────────────────────────────────────────────────

describe('scrubFileWithFFmpeg', () => {
  it('rejects files larger than the cap', async () => {
    const big = makeFile('big.mp4', MAX_SCRUB_INPUT_BYTES + 1)
    await expect(
      scrubFileWithFFmpeg({ file: big, action: { mode: 'strip' } })
    ).rejects.toThrow(/too large/)
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('writes, execs, reads, and returns output bytes; cleans up temp files', async () => {
    const out = new Uint8Array([9, 8, 7])
    mockReadFile.mockResolvedValue(out)
    const result = await scrubFileWithFFmpeg({
      file: makeFile('clip.mp4'),
      action: { mode: 'strip' },
    })
    expect(result).toBe(out)
    expect(mockWriteFile).toHaveBeenCalledOnce()
    expect(mockExec).toHaveBeenCalledOnce()
    expect(mockReadFile).toHaveBeenCalledOnce()
    // Both temp files deleted in finally
    expect(mockDeleteFile).toHaveBeenCalledTimes(2)
  })

  it('uses the file extension for temp names', async () => {
    await scrubFileWithFFmpeg({
      file: makeFile('movie.mkv'),
      action: { mode: 'strip' },
    })
    const inputName = (mockWriteFile.mock.calls[0] as unknown[])[0] as string
    expect(inputName).toMatch(/^scrub_in_.+\.mkv$/)
  })

  it('handles a filename with no extension', async () => {
    await scrubFileWithFFmpeg({
      file: makeFile('noext'),
      action: { mode: 'strip' },
    })
    const inputName = (mockWriteFile.mock.calls[0] as unknown[])[0] as string
    expect(inputName).toMatch(/^scrub_in_[a-z0-9]+$/)
    expect(inputName).not.toContain('.')
  })

  it('throws when ffmpeg exits non-zero', async () => {
    mockExec.mockResolvedValue(1)
    await expect(
      scrubFileWithFFmpeg({ file: makeFile('x.mp4'), action: { mode: 'strip' } })
    ).rejects.toThrow(/exit 1/)
  })

  it('throws when ffmpeg produces empty output', async () => {
    mockReadFile.mockResolvedValue(new Uint8Array(0))
    await expect(
      scrubFileWithFFmpeg({ file: makeFile('x.mp4'), action: { mode: 'strip' } })
    ).rejects.toThrow(/empty output/)
  })

  it('throws on unexpected (non-Uint8Array) ffmpeg output', async () => {
    mockReadFile.mockResolvedValue('a string' as unknown as Uint8Array<ArrayBuffer>)
    await expect(
      scrubFileWithFFmpeg({ file: makeFile('x.mp4'), action: { mode: 'strip' } })
    ).rejects.toThrow(/Unexpected/)
  })

  it('registers and removes the progress handler and forwards ratios', async () => {
    const onProgress = vi.fn()
    await scrubFileWithFFmpeg({
      file: makeFile('p.mp4'),
      action: { mode: 'strip' },
      onProgress,
    })
    expect(mockOn).toHaveBeenCalledWith('progress', expect.any(Function))
    expect(mockOff).toHaveBeenCalledWith('progress', expect.any(Function))

    // Invoke the registered callback to exercise the ratio-forwarding branch.
    const cb = mockOn.mock.calls[0][1] as (e: { progress: unknown }) => void
    cb({ progress: 0.5 })
    expect(onProgress).toHaveBeenCalledWith(0.5)
    // Non-number progress is ignored.
    onProgress.mockClear()
    cb({ progress: undefined })
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('does not register a progress handler when onProgress is absent', async () => {
    await scrubFileWithFFmpeg({
      file: makeFile('np.mp4'),
      action: { mode: 'strip' },
    })
    expect(mockOn).not.toHaveBeenCalled()
    expect(mockOff).not.toHaveBeenCalled()
  })

  it('skips temp deletion when ffmpeg is not loaded after a throw', async () => {
    mockExec.mockResolvedValue(2)
    mockLoaded = false
    await expect(
      scrubFileWithFFmpeg({ file: makeFile('x.mp4'), action: { mode: 'strip' } })
    ).rejects.toThrow(/exit 2/)
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('swallows errors from temp-file deletion', async () => {
    mockDeleteFile.mockRejectedValue(new Error('gone'))
    const result = await scrubFileWithFFmpeg({
      file: makeFile('x.mp4'),
      action: { mode: 'modify', fields: [{ key: 'title', value: 't' }] },
    })
    expect(result).toBeInstanceOf(Uint8Array)
  })
})

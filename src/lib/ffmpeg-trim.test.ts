import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MAX_TRIM_INPUT_BYTES } from './video-trim-scope.ts'

// ─── Mock: Vite ?url&inline import (no real worker URL in Node) ───────────────
vi.mock('@ffmpeg/ffmpeg/worker?url&inline', () => ({
  default: 'blob:mock-worker-url',
}))

// ─── Mock: @ffmpeg/util ───────────────────────────────────────────────────────
vi.mock('@ffmpeg/util', () => ({
  toBlobURL: vi.fn(async (url: string) => `blob:${url}`),
  fetchFile: vi.fn(async (file: File) => new Uint8Array(file.size)),
}))

// ─── Mock: @ffmpeg/ffmpeg ─────────────────────────────────────────────────────
// The module is imported dynamically inside getLoadedFFmpeg, so we need to
// stub it before the first call. vi.mock is hoisted automatically.

const mockOn = vi.fn()
const mockOff = vi.fn()
const mockWriteFile = vi.fn(async () => {})
const mockExec = vi.fn(async () => 0)
const mockReadFile = vi.fn(async () => new Uint8Array([1, 2, 3, 4]))
const mockDeleteFile = vi.fn(async () => {})
const mockTerminate = vi.fn()

// We track `loaded` as a plain property so tests can flip it.
let mockLoaded = false

const mockFFmpegInstance = {
  get loaded() {
    return mockLoaded
  },
  on: mockOn,
  off: mockOff,
  load: vi.fn(async () => {
    mockLoaded = true
  }),
  writeFile: mockWriteFile,
  exec: mockExec,
  readFile: mockReadFile,
  deleteFile: mockDeleteFile,
  terminate: mockTerminate,
}

vi.mock('@ffmpeg/ffmpeg', () => {
  // We need a real constructor function (not an arrow fn) so `new FFmpeg()`
  // works. It just returns the shared mock instance.
  function FFmpegMock(this: unknown) {
    return mockFFmpegInstance
  }
  return { FFmpeg: FFmpegMock }
})

// Import under test *after* mocks are registered.
import {
  trimVideoStreamCopy,
  terminateFFmpeg,
  type TrimProgress,
} from './ffmpeg-trim.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(name: string, sizeBytes: number, type = 'video/mp4'): File {
  const buf = new Uint8Array(sizeBytes)
  return new File([buf], name, { type })
}

beforeEach(() => {
  // Reset every mock call history and restore defaults.
  vi.clearAllMocks()

  // Re-wire load to flip loaded=true on the shared instance.
  mockFFmpegInstance.load.mockImplementation(async () => {
    mockLoaded = true
  })
  mockLoaded = false

  mockExec.mockResolvedValue(0)
  mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
  mockDeleteFile.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)

  // Each test starts with a fresh singleton by calling terminateFFmpeg().
  terminateFFmpeg()
})

// ─── trimVideoStreamCopy ──────────────────────────────────────────────────────

describe('trimVideoStreamCopy', () => {
  describe('argument validation', () => {
    it('throws when file exceeds MAX_TRIM_INPUT_BYTES', async () => {
      const file = makeFile('big.mp4', MAX_TRIM_INPUT_BYTES + 1)
      await expect(
        trimVideoStreamCopy({ file, startSec: 0, endSec: 10 })
      ).rejects.toThrow(/too large/i)
    })

    it('throws for zero-length trim (start === end)', async () => {
      const file = makeFile('video.mp4', 1024)
      await expect(
        trimVideoStreamCopy({ file, startSec: 5, endSec: 5 })
      ).rejects.toThrow(/Invalid trim range/i)
    })

    it('throws when duration is below 40 ms threshold', async () => {
      const file = makeFile('video.mp4', 1024)
      await expect(
        trimVideoStreamCopy({ file, startSec: 0, endSec: 0.03 })
      ).rejects.toThrow(/Invalid trim range/i)
    })

    it('throws for non-finite start or end', async () => {
      const file = makeFile('video.mp4', 1024)
      await expect(
        trimVideoStreamCopy({ file, startSec: Infinity, endSec: 10 })
      ).rejects.toThrow(/Invalid trim range/i)
      await expect(
        trimVideoStreamCopy({ file, startSec: 0, endSec: NaN })
      ).rejects.toThrow(/Invalid trim range/i)
    })
  })

  describe('success path', () => {
    it('returns a Uint8Array on success', async () => {
      const file = makeFile('clip.mp4', 512)
      const result = await trimVideoStreamCopy({
        file,
        startSec: 0,
        endSec: 10,
      })
      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('passes correct -ss, -t, -c copy args to ffmpeg.exec', async () => {
      const file = makeFile('clip.mp4', 512)
      await trimVideoStreamCopy({ file, startSec: 2, endSec: 7 })

      expect(mockExec).toHaveBeenCalledOnce()
      const [args] = mockExec.mock.calls[0] as unknown as [string[]]
      expect(args).toContain('-ss')
      expect(args[args.indexOf('-ss') + 1]).toBe('2')
      expect(args).toContain('-t')
      expect(args[args.indexOf('-t') + 1]).toBe('5')
      expect(args).toContain('-c')
      expect(args[args.indexOf('-c') + 1]).toBe('copy')
    })

    it('names the input file using the original extension', async () => {
      const file = makeFile('myclip.webm', 512, 'video/webm')
      await trimVideoStreamCopy({ file, startSec: 0, endSec: 5 })

      expect(mockWriteFile).toHaveBeenCalledOnce()
      const [inputName] = mockWriteFile.mock.calls[0] as unknown as [string, unknown]
      expect(inputName).toMatch(/\.webm$/)
    })

    it('falls back to .mp4 extension when filename has no dot', async () => {
      const file = makeFile('nodot', 512)
      await trimVideoStreamCopy({ file, startSec: 0, endSec: 5 })

      const [inputName] = mockWriteFile.mock.calls[0] as unknown as [string, unknown]
      expect(inputName).toMatch(/\.mp4$/)
    })

    it('normalises reversed start/end (start > end)', async () => {
      const file = makeFile('clip.mp4', 512)
      await trimVideoStreamCopy({ file, startSec: 10, endSec: 2 })

      const [args] = mockExec.mock.calls[0] as unknown as [string[]]
      // The earlier timestamp (2) becomes -ss and duration is 8.
      expect(args[args.indexOf('-ss') + 1]).toBe('2')
      expect(args[args.indexOf('-t') + 1]).toBe('8')
    })

    it('cleans up virtual FS files after a successful run', async () => {
      const file = makeFile('clip.mp4', 512)
      await trimVideoStreamCopy({ file, startSec: 0, endSec: 5 })
      expect(mockDeleteFile).toHaveBeenCalledTimes(2)
    })

    it('fires onProgress callbacks from ffmpeg progress events', async () => {
      // Capture the handler registered via ffmpeg.on('progress', …)
      let capturedHandler: ((e: { progress: number }) => void) | null = null
      mockOn.mockImplementation((_event: string, handler: (e: { progress: number }) => void) => {
        capturedHandler = handler
      })

      const file = makeFile('clip.mp4', 512)
      const onProgress: TrimProgress = vi.fn()

      // Intercept exec to fire a progress event mid-execution.
      mockExec.mockImplementation(async () => {
        capturedHandler?.({ progress: 0.5 })
        return 0
      })

      await trimVideoStreamCopy({ file, startSec: 0, endSec: 5, onProgress })

      expect(mockOn).toHaveBeenCalledWith('progress', expect.any(Function))
      expect(mockOff).toHaveBeenCalledWith('progress', expect.any(Function))
      expect(onProgress).toHaveBeenCalledWith(0.5)
    })

    it('does not register progress listeners when onProgress is omitted', async () => {
      const file = makeFile('clip.mp4', 512)
      await trimVideoStreamCopy({ file, startSec: 0, endSec: 5 })
      expect(mockOn).not.toHaveBeenCalled()
    })
  })

  describe('error paths', () => {
    it('throws when ffmpeg.exec returns a non-zero exit code', async () => {
      mockExec.mockResolvedValue(1)
      const file = makeFile('clip.mp4', 512)
      await expect(
        trimVideoStreamCopy({ file, startSec: 0, endSec: 5 })
      ).rejects.toThrow(/ffmpeg failed/i)
    })

    it('throws when readFile returns a non-Uint8Array value', async () => {
      mockReadFile.mockResolvedValue('unexpected string' as unknown as Uint8Array<ArrayBuffer>)
      const file = makeFile('clip.mp4', 512)
      await expect(
        trimVideoStreamCopy({ file, startSec: 0, endSec: 5 })
      ).rejects.toThrow(/Unexpected ffmpeg output/i)
    })

    it('still cleans up FS files even when exec throws', async () => {
      mockExec.mockRejectedValue(new Error('worker crash'))
      const file = makeFile('clip.mp4', 512)
      await expect(
        trimVideoStreamCopy({ file, startSec: 0, endSec: 5 })
      ).rejects.toThrow('worker crash')
      // loaded is true (mock didn't flip it back), so deleteFile should run.
      expect(mockDeleteFile).toHaveBeenCalledTimes(2)
    })

    it('skips FS cleanup when ffmpeg is no longer loaded', async () => {
      // Simulate ffmpeg.loaded becoming false mid-run (e.g. aborted).
      mockExec.mockImplementation(async () => {
        mockLoaded = false
        return 1
      })
      const file = makeFile('clip.mp4', 512)
      await expect(
        trimVideoStreamCopy({ file, startSec: 0, endSec: 5 })
      ).rejects.toThrow()
      expect(mockDeleteFile).not.toHaveBeenCalled()
    })
  })

  describe('AbortSignal support', () => {
    it('propagates the signal to ffmpeg.load, writeFile, exec, and readFile', async () => {
      const controller = new AbortController()
      const file = makeFile('clip.mp4', 512)
      await trimVideoStreamCopy({
        file,
        startSec: 0,
        endSec: 5,
        signal: controller.signal,
      })
      // load is called on the mock instance with { signal }
      expect(mockFFmpegInstance.load).toHaveBeenCalledWith(
        expect.any(Object),
        { signal: controller.signal }
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        { signal: controller.signal }
      )
      expect(mockExec).toHaveBeenCalledWith(
        expect.any(Array),
        undefined,
        { signal: controller.signal }
      )
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        { signal: controller.signal }
      )
    })
  })
})

// ─── terminateFFmpeg ──────────────────────────────────────────────────────────

describe('terminateFFmpeg', () => {
  it('can be called safely when ffmpeg was never loaded', () => {
    // terminateFFmpeg already called in beforeEach; calling again must not throw.
    expect(() => terminateFFmpeg()).not.toThrow()
  })

  it('calls terminate() on the loaded instance', async () => {
    // Load an instance first.
    const file = makeFile('clip.mp4', 512)
    await trimVideoStreamCopy({ file, startSec: 0, endSec: 5 })

    terminateFFmpeg()
    expect(mockTerminate).toHaveBeenCalledOnce()
  })

  it('resets the singleton so the next call re-loads', async () => {
    const file = makeFile('clip.mp4', 512)
    await trimVideoStreamCopy({ file, startSec: 0, endSec: 5 })

    const loadCallsAfterFirst = mockFFmpegInstance.load.mock.calls.length

    terminateFFmpeg()
    mockLoaded = false

    await trimVideoStreamCopy({ file, startSec: 0, endSec: 5 })
    expect(mockFFmpegInstance.load.mock.calls.length).toBe(loadCallsAfterFirst + 1)
  })
})

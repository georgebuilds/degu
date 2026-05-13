import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mock the ffmpeg wrapper so tests don't load wasm ---
const mockScrubFileWithFFmpeg = vi.hoisted(() =>
  vi.fn<(opts: { file: File }) => Promise<Uint8Array>>()
)

vi.mock('./ffmpeg-scrub', async () => {
  const actual =
    await vi.importActual<typeof import('./ffmpeg-scrub')>('./ffmpeg-scrub')
  return {
    ...actual,
    scrubFileWithFFmpeg: (opts: { file: File }) => mockScrubFileWithFFmpeg(opts),
    MAX_SCRUB_INPUT_BYTES: 1024 * 1024, // small cap for test
  }
})

// --- Mock media-paths walk ---
const mockCollectAllMediaRelativePaths = vi.hoisted(() =>
  vi.fn<() => Promise<string[]>>()
)

vi.mock('./media-paths', () => ({
  collectAllMediaRelativePaths: (
    _root: FileSystemDirectoryHandle,
    _opts?: unknown
  ) => mockCollectAllMediaRelativePaths(),
}))

import { buildFFmpegScrubArgs } from './ffmpeg-scrub'
import {
  canModifyMetadata,
  isScrubbable,
  MODIFIABLE_FIELDS,
  runScrubMetadata,
} from './scrub-metadata'

// ---------------------------------------------------------------------------
// In-memory FSA-shaped mocks
// ---------------------------------------------------------------------------

type MockWritable = {
  write: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

type MockFileHandle = {
  kind: 'file'
  name: string
  fileBytes: Uint8Array
  getFile: () => Promise<File>
  createWritable: () => Promise<MockWritable>
  lastWritten: Blob | Uint8Array | null
}

type MockDirHandle = {
  kind: 'directory'
  name: string
  files: Map<string, MockFileHandle>
  dirs: Map<string, MockDirHandle>
  getFileHandle: (name: string) => Promise<MockFileHandle>
  getDirectoryHandle: (name: string) => Promise<MockDirHandle>
}

function makeFile(name: string, size = 100): MockFileHandle {
  const bytes = new Uint8Array(size)
  const handle: MockFileHandle = {
    kind: 'file',
    name,
    fileBytes: bytes,
    lastWritten: null,
    async getFile() {
      return new File([bytes], name, { type: 'application/octet-stream' })
    },
    async createWritable() {
      const w: MockWritable = {
        write: vi.fn(async (data: Blob | Uint8Array) => {
          handle.lastWritten = data
        }),
        close: vi.fn(async () => {}),
      }
      return w
    },
  }
  return handle
}

function makeDir(
  name: string,
  entries: (MockFileHandle | MockDirHandle)[] = []
): MockDirHandle {
  const files = new Map<string, MockFileHandle>()
  const dirs = new Map<string, MockDirHandle>()
  for (const e of entries) {
    if (e.kind === 'file') files.set(e.name, e)
    else dirs.set(e.name, e)
  }
  return {
    kind: 'directory',
    name,
    files,
    dirs,
    async getFileHandle(n) {
      const fh = files.get(n)
      if (!fh) throw new DOMException(`Not found: ${n}`, 'NotFoundError')
      return fh
    },
    async getDirectoryHandle(n) {
      const dh = dirs.get(n)
      if (!dh) throw new DOMException(`Not found: ${n}`, 'NotFoundError')
      return dh
    },
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('isScrubbable', () => {
  it('accepts common image and video extensions', () => {
    expect(isScrubbable('a.jpg')).toBe(true)
    expect(isScrubbable('a.JPEG')).toBe(true)
    expect(isScrubbable('a.png')).toBe(true)
    expect(isScrubbable('a.webp')).toBe(true)
    expect(isScrubbable('a.avif')).toBe(true)
    expect(isScrubbable('a.gif')).toBe(true)
    expect(isScrubbable('a.mp4')).toBe(true)
    expect(isScrubbable('a.mov')).toBe(true)
    expect(isScrubbable('a.webm')).toBe(true)
  })

  it('rejects SVG and unknown extensions', () => {
    expect(isScrubbable('a.svg')).toBe(false)
    expect(isScrubbable('a.txt')).toBe(false)
    expect(isScrubbable('noext')).toBe(false)
  })
})

describe('canModifyMetadata', () => {
  it('allows video', () => {
    expect(canModifyMetadata('a.mp4')).toBe(true)
    expect(canModifyMetadata('a.mov')).toBe(true)
    expect(canModifyMetadata('a.webm')).toBe(true)
  })

  it('rejects images (v1 limitation)', () => {
    expect(canModifyMetadata('a.jpg')).toBe(false)
    expect(canModifyMetadata('a.png')).toBe(false)
    expect(canModifyMetadata('a.avif')).toBe(false)
  })
})

describe('MODIFIABLE_FIELDS', () => {
  it('exposes standard ffmpeg-friendly tag keys', () => {
    const keys = MODIFIABLE_FIELDS.map(f => f.key)
    expect(keys).toContain('title')
    expect(keys).toContain('artist')
    expect(keys).toContain('comment')
    expect(keys).toContain('copyright')
  })
})

describe('buildFFmpegScrubArgs', () => {
  it('strip mode emits -map_metadata -1 -c copy', () => {
    expect(buildFFmpegScrubArgs({ mode: 'strip' }, 'in.mp4', 'out.mp4')).toEqual([
      '-i',
      'in.mp4',
      '-map_metadata',
      '-1',
      '-c',
      'copy',
      'out.mp4',
    ])
  })

  it('modify mode preserves metadata and overlays -metadata flags', () => {
    expect(
      buildFFmpegScrubArgs(
        {
          mode: 'modify',
          fields: [
            { key: 'title', value: 'Hi' },
            { key: 'artist', value: 'Me' },
          ],
        },
        'in.mp4',
        'out.mp4'
      )
    ).toEqual([
      '-i',
      'in.mp4',
      '-map_metadata',
      '0',
      '-c',
      'copy',
      '-metadata',
      'title=Hi',
      '-metadata',
      'artist=Me',
      'out.mp4',
    ])
  })

  it('modify mode skips blank-key rows', () => {
    expect(
      buildFFmpegScrubArgs(
        {
          mode: 'modify',
          fields: [
            { key: '', value: 'orphan' },
            { key: '  ', value: 'whitespace' },
            { key: 'title', value: 'Real' },
          ],
        },
        'in.mp4',
        'out.mp4'
      )
    ).toEqual([
      '-i',
      'in.mp4',
      '-map_metadata',
      '0',
      '-c',
      'copy',
      '-metadata',
      'title=Real',
      'out.mp4',
    ])
  })

  it('modify mode trims surrounding whitespace from keys', () => {
    const args = buildFFmpegScrubArgs(
      { mode: 'modify', fields: [{ key: '  title  ', value: 'X' }] },
      'in.mp4',
      'out.mp4'
    )
    expect(args).toContain('title=X')
  })
})

// ---------------------------------------------------------------------------
// runScrubMetadata — integration with mocked ffmpeg + paths
// ---------------------------------------------------------------------------

describe('runScrubMetadata', () => {
  beforeEach(() => {
    mockScrubFileWithFFmpeg.mockReset()
    mockCollectAllMediaRelativePaths.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('strip: scrubs a single file and overwrites its bytes', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['photo.jpg'])
    const out = new Uint8Array([1, 2, 3])
    mockScrubFileWithFFmpeg.mockResolvedValue(out)

    const fh = makeFile('photo.jpg')
    const root = makeDir('root', [fh])

    const report = await runScrubMetadata(
      root as unknown as FileSystemDirectoryHandle,
      { kind: 'allMedia' },
      { mode: 'strip' }
    )

    expect(report.scrubbed).toBe(1)
    expect(report.failed).toHaveLength(0)
    expect(report.successfulScrubs).toEqual([{ path: 'photo.jpg' }])
    expect(fh.lastWritten).toBeInstanceOf(Blob)
    expect((fh.lastWritten as Blob).size).toBe(out.byteLength)
    expect(mockScrubFileWithFFmpeg).toHaveBeenCalledTimes(1)
  })

  it('skips SVG (unsupported by ffmpeg muxer)', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['logo.svg', 'a.mp4'])
    mockScrubFileWithFFmpeg.mockResolvedValue(new Uint8Array([0]))

    const svg = makeFile('logo.svg')
    const mp4 = makeFile('a.mp4')
    const root = makeDir('root', [svg, mp4])

    const report = await runScrubMetadata(
      root as unknown as FileSystemDirectoryHandle,
      { kind: 'allMedia' },
      { mode: 'strip' }
    )

    expect(report.skippedUnsupported).toBe(1)
    expect(report.scrubbed).toBe(1)
    expect(svg.lastWritten).toBeNull()
    expect(mp4.lastWritten).not.toBeNull()
  })

  it('skips images in modify mode (video-only v1)', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['p.jpg', 'v.mp4'])
    mockScrubFileWithFFmpeg.mockResolvedValue(new Uint8Array([7]))

    const jpg = makeFile('p.jpg')
    const mp4 = makeFile('v.mp4')
    const root = makeDir('root', [jpg, mp4])

    const report = await runScrubMetadata(
      root as unknown as FileSystemDirectoryHandle,
      { kind: 'allMedia' },
      { mode: 'modify', fields: [{ key: 'title', value: 'x' }] }
    )

    expect(report.skippedModifyImage).toBe(1)
    expect(report.scrubbed).toBe(1)
    expect(jpg.lastWritten).toBeNull()
    expect(mp4.lastWritten).not.toBeNull()
  })

  it('skips files larger than MAX_SCRUB_INPUT_BYTES', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['big.mp4'])
    // mocked cap is 1 MiB; file at 2 MiB
    const big = makeFile('big.mp4', 2 * 1024 * 1024)
    const root = makeDir('root', [big])

    const report = await runScrubMetadata(
      root as unknown as FileSystemDirectoryHandle,
      { kind: 'allMedia' },
      { mode: 'strip' }
    )

    expect(report.skippedTooLarge).toBe(1)
    expect(report.scrubbed).toBe(0)
    expect(mockScrubFileWithFFmpeg).not.toHaveBeenCalled()
  })

  it('records per-file failure when ffmpeg rejects', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['a.mp4', 'b.mp4'])
    mockScrubFileWithFFmpeg
      .mockRejectedValueOnce(new Error('codec exploded'))
      .mockResolvedValueOnce(new Uint8Array([1]))

    const a = makeFile('a.mp4')
    const b = makeFile('b.mp4')
    const root = makeDir('root', [a, b])

    const report = await runScrubMetadata(
      root as unknown as FileSystemDirectoryHandle,
      { kind: 'allMedia' },
      { mode: 'strip' }
    )

    expect(report.scrubbed).toBe(1)
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]!.path).toBe('a.mp4')
    expect(report.failed[0]!.message).toBe('codec exploded')
  })

  it('paths target: scrubs only the listed paths', async () => {
    const a = makeFile('a.mp4')
    const b = makeFile('b.mp4')
    const c = makeFile('c.mp4')
    const root = makeDir('root', [a, b, c])
    mockScrubFileWithFFmpeg.mockResolvedValue(new Uint8Array([1]))

    const report = await runScrubMetadata(
      root as unknown as FileSystemDirectoryHandle,
      { kind: 'paths', paths: ['a.mp4', 'c.mp4'] },
      { mode: 'strip' }
    )

    expect(report.scrubbed).toBe(2)
    expect(mockCollectAllMediaRelativePaths).not.toHaveBeenCalled()
    expect(a.lastWritten).not.toBeNull()
    expect(b.lastWritten).toBeNull()
    expect(c.lastWritten).not.toBeNull()
  })

  it('handles files in subdirectories', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['photos/vac.jpg'])
    mockScrubFileWithFFmpeg.mockResolvedValue(new Uint8Array([9]))

    const fh = makeFile('vac.jpg')
    const sub = makeDir('photos', [fh])
    const root = makeDir('root', [sub])

    const report = await runScrubMetadata(
      root as unknown as FileSystemDirectoryHandle,
      { kind: 'allMedia' },
      { mode: 'strip' }
    )

    expect(report.scrubbed).toBe(1)
    expect(report.successfulScrubs).toEqual([{ path: 'photos/vac.jpg' }])
    expect(fh.lastWritten).not.toBeNull()
  })

  it('aborts mid-run when signal fires', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['a.mp4', 'b.mp4'])
    const ac = new AbortController()
    let firstStarted = false
    mockScrubFileWithFFmpeg.mockImplementation(async () => {
      if (!firstStarted) {
        firstStarted = true
        ac.abort()
      }
      return new Uint8Array([1])
    })

    const root = makeDir('root', [makeFile('a.mp4'), makeFile('b.mp4')])

    await expect(
      runScrubMetadata(
        root as unknown as FileSystemDirectoryHandle,
        { kind: 'allMedia' },
        { mode: 'strip' },
        { signal: ac.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('emits progress events', async () => {
    mockCollectAllMediaRelativePaths.mockResolvedValue(['a.mp4', 'b.mp4'])
    mockScrubFileWithFFmpeg.mockResolvedValue(new Uint8Array([1]))
    const root = makeDir('root', [makeFile('a.mp4'), makeFile('b.mp4')])

    const events: { phase: string; done: number; total: number }[] = []
    await runScrubMetadata(
      root as unknown as FileSystemDirectoryHandle,
      { kind: 'allMedia' },
      { mode: 'strip' },
      {
        onProgress: p =>
          events.push({ phase: p.phase, done: p.done, total: p.total }),
      }
    )

    expect(events.some(e => e.phase === 'run' && e.done === 2 && e.total === 2)).toBe(
      true
    )
  })
})

/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoLoop } from '../lib/tags.ts'

const mockGetRecentTags = vi.hoisted(() => vi.fn((): string[] => []))

const loopStore = vi.hoisted(() => ({ map: new Map<string, VideoLoop[]>() }))

const trimMocks = vi.hoisted(() => ({
  trimVideoStreamCopy: vi.fn(),
  terminateFFmpeg: vi.fn(),
  saveTrimmedVideoBlob: vi.fn(),
}))

vi.mock('../lib/recent-tags.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/recent-tags.ts')>()
  return {
    ...actual,
    getRecentTags: () => mockGetRecentTags(),
    recordTagApplied: vi.fn(),
    subscribeRecentTags: () => () => {},
  }
})

vi.mock('../lib/tags.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/tags.ts')>()
  return {
    ...actual,
    getVideoLoops: (key: string) => loopStore.map.get(key) ?? [],
    setVideoLoops: (key: string, loops: VideoLoop[]) => {
      loopStore.map.set(key, loops)
    },
  }
})

vi.mock('../lib/ffmpeg-trim.ts', () => ({
  trimVideoStreamCopy: (...args: unknown[]) => trimMocks.trimVideoStreamCopy(...args),
  terminateFFmpeg: () => trimMocks.terminateFFmpeg(),
}))

vi.mock('../lib/save-trimmed-video.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/save-trimmed-video.ts')>()
  return {
    ...actual,
    saveTrimmedVideoBlob: (...args: unknown[]) => trimMocks.saveTrimmedVideoBlob(...args),
  }
})

// FaceOverlay is exercised by its own tests; stub it out so image-mode renders
// don't make network calls.
vi.mock('./FaceOverlay.tsx', () => ({
  FaceOverlay: () => null,
}))

import { PreviewModal } from './PreviewModal.tsx'

type PreviewModalProps = Parameters<typeof PreviewModal>[0]

function mockFileHandle(fileName: string, type = 'video/mp4', size = 1000): FileSystemFileHandle {
  return {
    kind: 'file',
    name: fileName,
    getFile: async () => {
      const f = new File([new Uint8Array([1, 2, 3])], fileName, { type })
      Object.defineProperty(f, 'size', { value: size })
      return f
    },
  } as FileSystemFileHandle
}

function baseProps(): PreviewModalProps {
  return {
    fileHandle: mockFileHandle('clip.mp4'),
    kind: 'video',
    tagStorageKey: 'clip.mp4',
    tags: [],
    onApplyFrequentTag: vi.fn(),
    onClose: vi.fn(),
    fileSizeBytes: 1000,
    fileName: 'clip.mp4',
    saveDirectoryHandle: null,
  }
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:test',
    revokeObjectURL: () => {},
  })
  loopStore.map.clear()
  trimMocks.trimVideoStreamCopy.mockResolvedValue(new Uint8Array([9, 9]))
  trimMocks.saveTrimmedVideoBlob.mockResolvedValue('download')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  mockGetRecentTags.mockReset()
  mockGetRecentTags.mockImplementation(() => [])
  vi.clearAllMocks()
})

describe('PreviewModal - header buttons', () => {
  it('renders Delete and Scrub buttons and wires them', async () => {
    const onDelete = vi.fn()
    const onScrubMetadata = vi.fn()
    render(<PreviewModal {...baseProps()} onDelete={onDelete} onScrubMetadata={onScrubMetadata} />)

    fireEvent.click(screen.getByRole('button', { name: 'Scrub…' }))
    expect(onScrubMetadata).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalled())
  })

  it('shows Deleting… while delete is in-flight (async onDelete)', async () => {
    let resolve!: () => void
    const onDelete = vi.fn(() => new Promise<void>(r => { resolve = r }))
    render(<PreviewModal {...baseProps()} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Deleting…' })).toBeTruthy())
    await act(async () => { resolve() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy())
  })

  it('omits Delete and Scrub when handlers absent', () => {
    render(<PreviewModal {...baseProps()} />)
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Scrub…' })).toBeNull()
  })

  it('closes on backdrop click and on Close button', () => {
    const onClose = vi.fn()
    render(<PreviewModal {...baseProps()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows existing tags chips when tags present', () => {
    render(<PreviewModal {...baseProps()} tags={['x', 'y']} />)
    expect(screen.getByText('x')).toBeTruthy()
    expect(screen.getByText('y')).toBeTruthy()
  })
})

describe('PreviewModal - video loops', () => {
  async function renderVideo(over: Partial<ReturnType<typeof baseProps>> = {}) {
    const props = { ...baseProps(), ...over }
    const utils = render(<PreviewModal {...props} />)
    await waitFor(() => expect(utils.container.querySelector('video')).toBeTruthy())
    const video = utils.container.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'currentTime', { value: 5, writable: true, configurable: true })
    return { ...utils, video, props }
  }

  it('shows empty-loops hint when there are no loops', async () => {
    await renderVideo()
    expect(screen.getByText('Mark start and end times, then save a loop.')).toBeTruthy()
  })

  it('creates a loop by marking start/end at playhead and saving', async () => {
    const { video } = await renderVideo()
    // currentTime = 5 for start
    fireEvent.click(screen.getByRole('button', { name: 'Start at current' }))
    // bump time for the end
    Object.defineProperty(video, 'currentTime', { value: 12, writable: true, configurable: true })
    fireEvent.click(screen.getByRole('button', { name: 'End at current' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save loop' }))

    await waitFor(() => {
      expect(loopStore.map.get('clip.mp4')?.length).toBe(1)
    })
    // loop list now shows export/delete controls
    expect(screen.getByRole('button', { name: 'Export trim' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play loop' })).toBeTruthy()
  })

  it('renders preexisting loops with play/stop toggle', async () => {
    loopStore.map.set('clip.mp4', [{ id: 'L1', startSec: 1, endSec: 4 }])
    await renderVideo()
    const play = await screen.findByRole('button', { name: 'Play loop' })
    fireEvent.click(play)
    expect(screen.getByRole('button', { name: 'Stop loop' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop loop' }))
    expect(screen.getByRole('button', { name: 'Play loop' })).toBeTruthy()
  })

  it('deletes a loop', async () => {
    loopStore.map.set('clip.mp4', [{ id: 'L1', startSec: 1, endSec: 4 }])
    await renderVideo()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(loopStore.map.get('clip.mp4')?.length).toBe(0))
  })

  it('edits loop times via inputs + Apply times', async () => {
    loopStore.map.set('clip.mp4', [{ id: 'L1', startSec: 1, endSec: 4 }])
    await renderVideo()
    const startInput = (await screen.findByText('Start (s)')).querySelector('input')!
    const endInput = screen.getByText('End (s)').querySelector('input')!
    fireEvent.input(startInput, { target: { value: '2' } })
    fireEvent.input(endInput, { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply times' }))
    await waitFor(() => {
      const l = loopStore.map.get('clip.mp4')![0]!
      expect(l.startSec).toBe(2)
      expect(l.endSec).toBe(9)
    })
  })

  it('sets loop start/end from playhead', async () => {
    loopStore.map.set('clip.mp4', [{ id: 'L1', startSec: 1, endSec: 4 }])
    const { video } = await renderVideo()
    Object.defineProperty(video, 'currentTime', { value: 7, writable: true, configurable: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Start ← playhead' }))
    Object.defineProperty(video, 'currentTime', { value: 8, writable: true, configurable: true })
    fireEvent.click(screen.getByRole('button', { name: 'End ← playhead' }))
    const startInput = screen.getByText('Start (s)').querySelector('input')! as HTMLInputElement
    expect(startInput.value).toBe('7')
  })

  it('adds loop to viewer when handler provided', async () => {
    loopStore.map.set('clip.mp4', [{ id: 'L1', startSec: 1, endSec: 4 }])
    const onAddLoopToViewer = vi.fn()
    await renderVideo({ onAddLoopToViewer })
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Viewer' }))
    expect(onAddLoopToViewer).toHaveBeenCalledWith({ id: 'L1', startSec: 1, endSec: 4 })
  })

  it('updates duration from onLoadedMetadata and triggers play on loadeddata', async () => {
    const { video } = await renderVideo()
    Object.defineProperty(video, 'duration', { value: 30, configurable: true })
    fireEvent(video, new Event('loadedmetadata'))
    // isConnected true, play() defined to avoid crash
    video.play = vi.fn().mockResolvedValue(undefined)
    fireEvent(video, new Event('loadeddata'))
    expect(video.play).toHaveBeenCalled()
  })
})

describe('PreviewModal - trim export', () => {
  function renderVideo(over: Partial<ReturnType<typeof baseProps>> = {}) {
    const props = { ...baseProps(), ...over }
    const utils = render(<PreviewModal {...props} />)
    return { ...utils, props }
  }

  it('exports a trim, shows progress, and reports saved sizes', async () => {
    loopStore.map.set('clip.mp4', [{ id: 'L1', startSec: 1, endSec: 4 }])
    let onProgress!: (p: number) => void
    trimMocks.trimVideoStreamCopy.mockImplementation(async (args: { onProgress: (p: number) => void }) => {
      onProgress = args.onProgress
      return new Uint8Array([1, 2])
    })
    await renderVideo({ saveDirectoryHandle: {} as FileSystemDirectoryHandle })
    fireEvent.click(await screen.findByRole('button', { name: 'Export trim' }))
    await waitFor(() => expect(trimMocks.trimVideoStreamCopy).toHaveBeenCalled())
    await act(async () => { onProgress(0.5) })
    await waitFor(() => expect(screen.getByText('Trim saved')).toBeTruthy())
  })

  it('reports the saveAsPicker variant message', async () => {
    loopStore.map.set('clip.mp4', [{ id: 'L1', startSec: 1, endSec: 4 }])
    trimMocks.saveTrimmedVideoBlob.mockResolvedValue('saveAsPicker')
    await renderVideo()
    fireEvent.click(await screen.findByRole('button', { name: 'Export trim' }))
    await waitFor(() => expect(screen.getByText(/Net disk space won/)).toBeTruthy())
  })

  it('surfaces a trim failure as an error message', async () => {
    loopStore.map.set('clip.mp4', [{ id: 'L1', startSec: 1, endSec: 4 }])
    trimMocks.trimVideoStreamCopy.mockRejectedValue(new Error('ffmpeg blew up'))
    await renderVideo()
    fireEvent.click(await screen.findByRole('button', { name: 'Export trim' }))
    await waitFor(() => expect(screen.getByText('ffmpeg blew up')).toBeTruthy())
  })

  it('reports an AbortError as cancelled', async () => {
    loopStore.map.set('clip.mp4', [{ id: 'L1', startSec: 1, endSec: 4 }])
    trimMocks.trimVideoStreamCopy.mockRejectedValue(
      new DOMException('aborted', 'AbortError')
    )
    await renderVideo()
    fireEvent.click(await screen.findByRole('button', { name: 'Export trim' }))
    await waitFor(() => expect(screen.getByText('Trim cancelled.')).toBeTruthy())
  })

  it('rejects files larger than the trim limit', async () => {
    const huge = 5 * 1024 * 1024 * 1024
    loopStore.map.set('big.mp4', [{ id: 'L1', startSec: 1, endSec: 4 }])
    render(
      <PreviewModal
        {...baseProps()}
        fileHandle={mockFileHandle('big.mp4', 'video/mp4', huge)}
        tagStorageKey="big.mp4"
        fileName="big.mp4"
        fileSizeBytes={1000}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Export trim' }))
    await waitFor(() => expect(screen.getByText(/too large to trim here/)).toBeTruthy())
  })

  it('warns when fileSizeBytes exceeds the trim limit and disables export', async () => {
    const huge = 5 * 1024 * 1024 * 1024
    loopStore.map.set('clip.mp4', [{ id: 'L1', startSec: 1, endSec: 4 }])
    render(<PreviewModal {...baseProps()} fileSizeBytes={huge} />)
    expect(await screen.findByText(/exceeds the/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Export trim' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('PreviewModal - navigation & image mode', () => {
  it('navigates siblings with arrow keys when handler provided', () => {
    const onNavigateSibling = vi.fn()
    render(<PreviewModal {...baseProps()} onNavigateSibling={onNavigateSibling} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onNavigateSibling).toHaveBeenCalledWith(1)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onNavigateSibling).toHaveBeenCalledWith(-1)
  })

  it('ignores arrow keys originating from editable targets', () => {
    const onNavigateSibling = vi.fn()
    render(<PreviewModal {...baseProps()} onNavigateSibling={onNavigateSibling} />)
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(onNavigateSibling).not.toHaveBeenCalled()
  })

  it('renders image content for image kind', async () => {
    const { container } = render(
      <PreviewModal {...baseProps()} kind="image" tagStorageKey="p.jpg" fileName="p.jpg" />
    )
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy())
    expect(container.querySelector('video')).toBeNull()
  })
})

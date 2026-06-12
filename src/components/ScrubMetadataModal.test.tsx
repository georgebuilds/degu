/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ScrubAction,
  ScrubReport,
  ScrubTarget,
} from '../lib/scrub-metadata'

type RunOptions = {
  signal?: AbortSignal
  onProgress?: (p: unknown) => void
}

const mockRunScrubMetadata = vi.hoisted(() =>
  vi.fn(
    (
      _root: unknown,
      _target: ScrubTarget,
      _action: ScrubAction,
      _options?: RunOptions
    ): Promise<ScrubReport> => Promise.resolve(emptyReport())
  )
)

function emptyReport(): ScrubReport {
  return {
    scrubbed: 0,
    skippedUnsupported: 0,
    skippedTooLarge: 0,
    skippedModifyImage: 0,
    failed: [],
    successfulScrubs: [],
  }
}

vi.mock('../lib/scrub-metadata', () => ({
  runScrubMetadata: (
    root: unknown,
    target: ScrubTarget,
    action: ScrubAction,
    options?: RunOptions
  ) => mockRunScrubMetadata(root, target, action, options),
  MODIFIABLE_FIELDS: [
    { key: 'title', label: 'Title' },
    { key: 'artist', label: 'Artist' },
    { key: 'comment', label: 'Comment' },
  ],
}))

import { ScrubMetadataModal } from './ScrubMetadataModal.tsx'

const rootHandle = {} as FileSystemDirectoryHandle
const target: ScrubTarget = { kind: 'allMedia' }

function renderModal(overrides?: {
  onClose?: () => void
  onComplete?: (r: ScrubReport) => void
}) {
  const onClose = overrides?.onClose ?? vi.fn()
  const onComplete = overrides?.onComplete ?? vi.fn()
  render(
    <ScrubMetadataModal
      rootHandle={rootHandle}
      target={target}
      targetLabel="All media"
      onClose={onClose}
      onComplete={onComplete}
    />
  )
  return { onClose, onComplete }
}

afterEach(() => {
  cleanup()
  mockRunScrubMetadata.mockReset()
  mockRunScrubMetadata.mockResolvedValue(emptyReport())
})

beforeEach(() => {
  mockRunScrubMetadata.mockResolvedValue(emptyReport())
})

describe('ScrubMetadataModal', () => {
  it('renders configure phase with target label and Strip selected by default', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Scrub metadata' })).toBeTruthy()
    expect(screen.getByText('All media')).toBeTruthy()
    const strip = screen.getByRole('radio', { name: /Strip all metadata/i }) as HTMLInputElement
    expect(strip.checked).toBe(true)
    // Strip warning is shown; field editor is not.
    expect(screen.getByText(/may appear rotated/i)).toBeTruthy()
    expect(screen.queryByText('Fields to set')).toBeNull()
  })

  it('Cancel button invokes onClose in configure phase', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('switching to Modify shows field editor and Run is disabled until a field has a value', () => {
    renderModal()
    fireEvent.click(screen.getByRole('radio', { name: /Modify metadata/i }))
    expect(screen.getByText('Fields to set')).toBeTruthy()

    const runBtn = screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement
    expect(runBtn.disabled).toBe(true)

    fireEvent.input(screen.getByPlaceholderText('Value'), {
      target: { value: 'My Title' },
    })
    expect(runBtn.disabled).toBe(false)
  })

  it('adds and removes fields; Remove is disabled when only one field remains', () => {
    renderModal()
    fireEvent.click(screen.getByRole('radio', { name: /Modify metadata/i }))

    const removeFirst = screen.getByRole('button', { name: 'Remove field' }) as HTMLButtonElement
    expect(removeFirst.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '+ Add field' }))
    expect(screen.getAllByPlaceholderText('Value')).toHaveLength(2)

    const removeButtons = screen.getAllByRole('button', { name: 'Remove field' })
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(removeButtons[0]!)
    expect(screen.getAllByPlaceholderText('Value')).toHaveLength(1)
  })

  it('runs strip and transitions to report phase, calling onComplete', async () => {
    const report: ScrubReport = { ...emptyReport(), scrubbed: 5 }
    mockRunScrubMetadata.mockResolvedValue(report)
    const { onComplete } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
    )
    expect(onComplete).toHaveBeenCalledWith(report)

    const [, calledTarget, calledAction] = mockRunScrubMetadata.mock.calls[0]!
    expect(calledTarget).toEqual(target)
    expect(calledAction).toEqual({ mode: 'strip' })

    // Report breakdown shows the scrubbed count.
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('Scrubbed:')).toBeTruthy()
  })

  it('passes modify action with only valid fields', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('radio', { name: /Modify metadata/i }))
    fireEvent.input(screen.getByPlaceholderText('Value'), {
      target: { value: 'Hello' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(mockRunScrubMetadata).toHaveBeenCalled())
    const [, , calledAction] = mockRunScrubMetadata.mock.calls[0]!
    expect(calledAction).toEqual({
      mode: 'modify',
      fields: [{ key: 'title', value: 'Hello' }],
    })
  })

  it('renders progress while running and shows a progressbar', async () => {
    let resolveRun: ((r: ScrubReport) => void) | null = null
    mockRunScrubMetadata.mockImplementation((_r, _t, _a, options?: RunOptions) => {
      options?.onProgress?.({ phase: 'run', done: 2, total: 4, currentPath: 'a/b.mp4' })
      return new Promise<ScrubReport>(resolve => {
        resolveRun = resolve
      })
    })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(screen.getByRole('progressbar')).toBeTruthy())
    expect(screen.getByText(/Scrubbing… 2 \/ 4/)).toBeTruthy()

    resolveRun!(emptyReport())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
    )
  })

  it('Cancel during running aborts the run, closing the modal', async () => {
    let receivedSignal: AbortSignal | undefined
    mockRunScrubMetadata.mockImplementation((_r, _t, _a, options?: RunOptions) => {
      receivedSignal = options?.signal
      return new Promise<ScrubReport>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(screen.getByRole('progressbar')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(receivedSignal?.aborted).toBe(true)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('shows error and returns to configure phase when run rejects', async () => {
    mockRunScrubMetadata.mockRejectedValue(new Error('ffmpeg boom'))
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(screen.getByText('ffmpeg boom')).toBeTruthy())
    // Back in configure: Run button present again.
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy()
  })

  it('report phase lists failures and skip counts; Done invokes onClose', async () => {
    const report: ScrubReport = {
      scrubbed: 3,
      skippedUnsupported: 1,
      skippedTooLarge: 2,
      skippedModifyImage: 4,
      failed: [{ path: 'x/y.mov', message: 'bad container' }],
      successfulScrubs: [],
    }
    mockRunScrubMetadata.mockResolvedValue(report)
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
    )
    expect(screen.getByText(/Skipped \(unsupported format\):/)).toBeTruthy()
    expect(screen.getByText(/Skipped \(too large\):/)).toBeTruthy()
    expect(screen.getByText(/Skipped \(modify is video-only\):/)).toBeTruthy()
    expect(screen.getByText(/x\/y\.mov: bad container/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape closes in configure phase', () => {
    const { onClose } = renderModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  NormalizeProgress,
  NormalizeReport,
  RunNormalizeFilenamesOptions,
} from '../lib/normalize-filenames'

type RunArgs = {
  root: FileSystemDirectoryHandle
  rows: string[]
  opts: RunNormalizeFilenamesOptions
}

const runState = vi.hoisted(() => ({
  calls: [] as RunArgs[],
  resolve: null as ((r: NormalizeReport) => void) | null,
  reject: null as ((e: unknown) => void) | null,
  lastOpts: null as RunNormalizeFilenamesOptions | null,
}))

const runNormalizeFilenames = vi.hoisted(() =>
  vi.fn(
    (
      root: FileSystemDirectoryHandle,
      rows: string[],
      opts: RunNormalizeFilenamesOptions
    ) => {
      runState.calls.push({ root, rows, opts })
      runState.lastOpts = opts
      return new Promise<NormalizeReport>((resolve, reject) => {
        runState.resolve = resolve
        runState.reject = reject
      })
    }
  )
)

vi.mock('../lib/normalize-filenames', () => ({
  runNormalizeFilenames,
}))

import { NormalizeFilenamesModal } from './NormalizeFilenamesModal.tsx'

const rootHandle = {} as FileSystemDirectoryHandle

function makeReport(overrides: Partial<NormalizeReport> = {}): NormalizeReport {
  return {
    renamed: 5,
    unchanged: 2,
    skippedCollision: 1,
    skippedInvalid: 0,
    failed: [],
    successfulRenames: [],
    tagIndexFlushError: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  runState.calls = []
  runState.resolve = null
  runState.reject = null
  runState.lastOpts = null
})

describe('NormalizeFilenamesModal', () => {
  it('renders the configure phase with one empty input row', () => {
    render(
      <NormalizeFilenamesModal
        rootHandle={rootHandle}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    )

    expect(
      screen.getByRole('dialog', { name: 'Normalize filenames' })
    ).toBeTruthy()
    expect(screen.getAllByPlaceholderText('e.g. copy, _01')).toHaveLength(1)
    // The lone row's Remove button is disabled.
    expect(
      screen.getByRole('button', { name: 'Remove row' }).hasAttribute('disabled')
    ).toBe(true)
  })

  it('adds and removes string rows', () => {
    render(
      <NormalizeFilenamesModal
        rootHandle={rootHandle}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '+ Add string' }))
    expect(screen.getAllByPlaceholderText('e.g. copy, _01')).toHaveLength(2)

    // With two rows, both Remove buttons are enabled.
    const removeButtons = screen.getAllByRole('button', { name: 'Remove row' })
    expect(removeButtons[0]!.hasAttribute('disabled')).toBe(false)
    fireEvent.click(removeButtons[0]!)
    expect(screen.getAllByPlaceholderText('e.g. copy, _01')).toHaveLength(1)
  })

  it('passes typed rows to runNormalizeFilenames on Run', () => {
    render(
      <NormalizeFilenamesModal
        rootHandle={rootHandle}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText('e.g. copy, _01')
    fireEvent.input(input, { target: { value: 'copy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(runNormalizeFilenames).toHaveBeenCalledTimes(1)
    expect(runState.calls[0]!.rows).toEqual(['copy'])
  })

  it('shows the running phase with progress, then the report on completion', async () => {
    const onComplete = vi.fn()
    render(
      <NormalizeFilenamesModal
        rootHandle={rootHandle}
        onClose={vi.fn()}
        onComplete={onComplete}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => {
      expect(screen.getByText('Scanning folders…')).toBeTruthy()
    })

    // Drive a run-phase progress update.
    const progress: NormalizeProgress = { phase: 'run', done: 3, total: 10 }
    runState.lastOpts?.onProgress?.(progress)
    await waitFor(() => {
      expect(screen.getByText('Renaming… 3 / 10')).toBeTruthy()
    })

    const report = makeReport()
    runState.resolve?.(report)
    await waitFor(() => {
      expect(screen.getByText('Renamed:')).toBeTruthy()
    })
    expect(onComplete).toHaveBeenCalledWith(report)
    expect(screen.getByText('5')).toBeTruthy()
  })

  it('shows failed entries and the tag-index flush error in the report', async () => {
    render(
      <NormalizeFilenamesModal
        rootHandle={rootHandle}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    runState.resolve?.(
      makeReport({
        failed: [{ path: 'a/b.jpg', message: 'EPERM' }],
        tagIndexFlushError: 'disk full',
      })
    )

    await waitFor(() => {
      expect(screen.getByText(/a\/b\.jpg: EPERM/)).toBeTruthy()
    })
    expect(screen.getByText(/disk full/)).toBeTruthy()
  })

  it('Done in the report phase calls onClose', async () => {
    const onClose = vi.fn()
    render(
      <NormalizeFilenamesModal
        rootHandle={rootHandle}
        onClose={onClose}
        onComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    runState.resolve?.(makeReport())
    const done = await screen.findByRole('button', { name: 'Done' })
    fireEvent.click(done)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a thrown error returns to configure and shows the message', async () => {
    render(
      <NormalizeFilenamesModal
        rootHandle={rootHandle}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    runState.reject?.(new Error('boom'))

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeTruthy()
    })
    // Back in configure phase: the Run button is present again.
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy()
  })

  it('an AbortError closes the modal instead of showing an error', async () => {
    const onClose = vi.fn()
    render(
      <NormalizeFilenamesModal
        rootHandle={rootHandle}
        onClose={onClose}
        onComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    runState.reject?.(new DOMException('aborted', 'AbortError'))

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('Cancel in configure phase calls onClose', () => {
    const onClose = vi.fn()
    render(
      <NormalizeFilenamesModal
        rootHandle={rootHandle}
        onClose={onClose}
        onComplete={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

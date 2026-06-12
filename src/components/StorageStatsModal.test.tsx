/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  StorageStatsProgress,
  StorageStatsReport,
} from '../lib/storage-stats'

type Options = {
  onProgress?: (p: StorageStatsProgress) => void
  progressEvery?: number
}

const mockComputeStorageStats = vi.hoisted(() =>
  vi.fn(
    (_root: unknown, _options?: Options): Promise<StorageStatsReport> =>
      Promise.resolve(sampleReport())
  )
)

function sampleReport(): StorageStatsReport {
  return {
    totalBytes: 3_000_000,
    fileCount: 4,
    byKind: { image: 1_000_000, video: 1_500_000, other: 500_000 },
    byExtension: [
      { ext: '.mp4', bytes: 1_500_000 },
      { ext: '.jpg', bytes: 1_000_000 },
    ],
    byTag: [
      { tag: 'vacation', bytes: 2_000_000 },
      { tag: 'family', bytes: 800_000 },
    ],
    untaggedBytes: 500_000,
  }
}

vi.mock('../lib/storage-stats', () => ({
  computeStorageStats: (root: unknown, options?: Options) =>
    mockComputeStorageStats(root, options),
}))

import { StorageStatsModal } from './StorageStatsModal.tsx'

const rootHandle = {} as FileSystemDirectoryHandle

function renderModal(onClose = vi.fn()) {
  render(
    <StorageStatsModal
      rootHandle={rootHandle}
      rootName="media"
      onClose={onClose}
    />
  )
  return { onClose }
}

afterEach(() => {
  cleanup()
  mockComputeStorageStats.mockReset()
  mockComputeStorageStats.mockResolvedValue(sampleReport())
})

beforeEach(() => {
  mockComputeStorageStats.mockResolvedValue(sampleReport())
})

describe('StorageStatsModal', () => {
  it('renders intro phase with root name and a Scan folder button', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Storage report' })).toBeTruthy()
    expect(screen.getByText(/media/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Scan folder' })).toBeTruthy()
    // No "Scan again" until a report exists.
    expect(screen.queryByRole('button', { name: 'Scan again' })).toBeNull()
  })

  it('Close in intro phase invokes onClose', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows running progress with a progressbar and counts', async () => {
    let resolveRun: ((r: StorageStatsReport) => void) | null = null
    mockComputeStorageStats.mockImplementation((_root, options?: Options) => {
      options?.onProgress?.({ filesScanned: 12, dirsVisited: 3, bytesSoFar: 2048 })
      return new Promise<StorageStatsReport>(resolve => {
        resolveRun = resolve
      })
    })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Scan folder' }))

    await waitFor(() => expect(screen.getByRole('progressbar')).toBeTruthy())
    expect(screen.getByText(/12 files/)).toBeTruthy()
    expect(screen.getByText(/3 folders/)).toBeTruthy()

    // Close is disabled while running.
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true)

    resolveRun!(sampleReport())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Scan again' })).toBeTruthy()
    )
  })

  it('renders the full stats breakdown in done phase', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Scan folder' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Scan again' })).toBeTruthy()
    )

    // Total + file count.
    expect(screen.getByText('2.9 MB')).toBeTruthy()
    expect(screen.getByText(/4 files/)).toBeTruthy()

    // By kind headings.
    expect(screen.getByText('Images')).toBeTruthy()
    expect(screen.getByText('Videos')).toBeTruthy()
    expect(screen.getByText('Other files')).toBeTruthy()

    // Extension + tag rows.
    expect(screen.getByText('.mp4')).toBeTruthy()
    expect(screen.getByText('.jpg')).toBeTruthy()
    expect(screen.getByText('vacation')).toBeTruthy()
    expect(screen.getByText('family')).toBeTruthy()
    expect(screen.getByText('Untagged')).toBeTruthy()

    expect(mockComputeStorageStats).toHaveBeenCalledWith(
      rootHandle,
      expect.objectContaining({ progressEvery: 32 })
    )
  })

  it('singularises file count and shows empty placeholders', async () => {
    mockComputeStorageStats.mockResolvedValue({
      totalBytes: 100,
      fileCount: 1,
      byKind: { image: 100, video: 0, other: 0 },
      byExtension: [],
      byTag: [],
      untaggedBytes: 100,
    })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Scan folder' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Scan again' })).toBeTruthy()
    )
    expect(screen.getByText(/1 file$/)).toBeTruthy()
    expect(screen.getByText('No files found.')).toBeTruthy()
    expect(screen.getByText('No tagged files.')).toBeTruthy()
  })

  it('shows error and returns to intro phase when scan rejects', async () => {
    mockComputeStorageStats.mockRejectedValue(new Error('scan failed'))
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Scan folder' }))

    await waitFor(() => expect(screen.getByText('scan failed')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Scan folder' })).toBeTruthy()
  })

  it('Scan again re-runs the computation', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Scan folder' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Scan again' })).toBeTruthy()
    )
    expect(mockComputeStorageStats).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }))
    await waitFor(() =>
      expect(mockComputeStorageStats).toHaveBeenCalledTimes(2)
    )
  })

  it('Close after done invokes onClose; Escape closes from intro', async () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Scan folder' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Scan again' })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

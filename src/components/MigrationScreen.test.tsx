// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/preact'
import { MigrationScreen } from './MigrationScreen'
import type { LegacyIndexStatus } from '../lib/legacy-index-api'

// Controllable mock for the import stream: streamLegacyIndexImport returns a
// promise we resolve manually, so we can unmount while the import is in flight.
let resolveImport: ((r: unknown) => void) | null = null
let onProgressCb: ((p: unknown) => void) | null = null

vi.mock('../lib/legacy-index-api', () => ({
  streamLegacyIndexImport: vi.fn((handlers: { onProgress: (p: unknown) => void }) => {
    onProgressCb = handlers.onProgress
    return new Promise(resolve => {
      resolveImport = resolve
    })
  }),
}))

const status: LegacyIndexStatus = { available: true, entryCount: 3 }

describe('MigrationScreen', () => {
  beforeEach(() => {
    resolveImport = null
    onProgressCb = null
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('does not call setState after unmount when an import is in flight', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { getByRole, unmount } = render(
      <MigrationScreen
        rootFolderName="media"
        status={status}
        onDone={() => {}}
        onSkip={() => {}}
      />
    )

    // Kick off the import — this starts the async loop that awaits our pending promise.
    fireEvent.click(getByRole('button', { name: /import 3/i }))
    expect(resolveImport).not.toBeNull()

    // Unmount before the import resolves — mountedRef flips to false.
    unmount()

    // Now resolve the import and flush microtasks. The guarded setPhase calls
    // must be skipped; no warning / error should be emitted.
    onProgressCb?.({ phase: 'verifying', done: 1, total: 3 })
    resolveImport?.({ imported: 3, missing: [], skippedMalformed: 0 })
    await Promise.resolve()
    await Promise.resolve()

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('mounts and unmounts cleanly while an import is in flight', () => {
    const { getByRole, unmount } = render(
      <MigrationScreen
        rootFolderName="media"
        status={status}
        onDone={() => {}}
        onSkip={() => {}}
      />
    )
    fireEvent.click(getByRole('button', { name: /import 3/i }))
    expect(() => unmount()).not.toThrow()
  })
})

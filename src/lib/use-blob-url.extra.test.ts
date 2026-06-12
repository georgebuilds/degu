/** @vitest-environment happy-dom */
import { render, cleanup, waitFor } from '@testing-library/preact'
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileBlobURL } from './use-blob-url'

let lastState: { url: string | null; error: string | null } = {
  url: null,
  error: null,
}

function Probe({ handle }: { handle: FileSystemFileHandle }) {
  lastState = useFileBlobURL(handle)
  return null
}

beforeEach(() => {
  lastState = { url: null, error: null }
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fake-url'),
    revokeObjectURL: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useFileBlobURL error path', () => {
  it('exposes the Error message when getFile() rejects', async () => {
    const handle = {
      getFile: vi.fn(async () => {
        throw new Error('file moved')
      }),
    } as unknown as FileSystemFileHandle

    render(h(Probe, { handle }))
    await waitFor(() => {
      expect(lastState.error).toBe('file moved')
    })
    expect(lastState.url).toBeNull()
  })

  it('falls back to a default message for non-Error rejections', async () => {
    const handle = {
      getFile: vi.fn(async () => {
        throw 'oops'
      }),
    } as unknown as FileSystemFileHandle

    render(h(Probe, { handle }))
    await waitFor(() => {
      expect(lastState.error).toBe('Could not read file')
    })
    expect(lastState.url).toBeNull()
  })

  it('resolves to a blob URL on success', async () => {
    const handle = {
      getFile: vi.fn(async () => new Blob(['x'])),
    } as unknown as FileSystemFileHandle

    render(h(Probe, { handle }))
    await waitFor(() => {
      expect(lastState.url).toBe('blob:fake-url')
    })
    expect(lastState.error).toBeNull()
  })
})

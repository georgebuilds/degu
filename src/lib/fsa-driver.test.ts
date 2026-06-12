import { describe, it, expect, vi } from 'vitest'
import { FsaDriver } from './fsa-driver'
import type { TagPayload } from './storage-driver'

const INDEX_TMP_FILE = 'index.json.tmp'

function emptyPayload(): TagPayload {
  return { tags: {}, videoLoops: {}, tagCreatedAt: {}, lastReviewed: {} }
}

/**
 * Build a fake FileSystemDirectoryHandle whose tmp file's writable rejects on
 * write(). Tracks removeEntry calls so we can assert the orphan cleanup runs.
 */
function makeFailingHandle() {
  const close = vi.fn(async () => {})
  const removeEntry = vi.fn(async (_name: string) => {})
  const writable = {
    write: vi.fn(async () => {
      throw new Error('disk full')
    }),
    close,
  }
  const fileHandle = {
    createWritable: vi.fn(async () => writable),
  }
  const handle = {
    name: 'root',
    getFileHandle: vi.fn(async (_name: string, _opts?: { create?: boolean }) => fileHandle),
    removeEntry,
  } as unknown as FileSystemDirectoryHandle

  return { handle, removeEntry, close, writable }
}

describe('FsaDriver.saveTags', () => {
  it('removes the orphaned tmp file when the writable write throws', async () => {
    const { handle, removeEntry, close, writable } = makeFailingHandle()
    const driver = FsaDriver.forTesting(handle)

    await expect(driver.saveTags(emptyPayload())).rejects.toThrow('disk full')

    expect(writable.write).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(removeEntry).toHaveBeenCalledWith(INDEX_TMP_FILE)
  })
})

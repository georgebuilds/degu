import { describe, expect, it, vi } from 'vitest'
import { saveTrimmedVideoBlob, trimmedFilenameSuggestion } from './save-trimmed-video.ts'

describe('trimmedFilenameSuggestion', () => {
  it('inserts .trimmed before extension', () => {
    expect(trimmedFilenameSuggestion('clip.mp4')).toBe('clip.trimmed.mp4')
  })

  it('handles multiple dots in name', () => {
    expect(trimmedFilenameSuggestion('my.video.backup.webm')).toBe(
      'my.video.backup.trimmed.webm'
    )
  })

  it('uses .trimmed.mp4 when there is no extension', () => {
    expect(trimmedFilenameSuggestion('noext')).toBe('noext.trimmed.mp4')
  })

  it('treats leading dot as no valid extension', () => {
    expect(trimmedFilenameSuggestion('.hidden')).toBe('.hidden.trimmed.mp4')
  })
})

describe('saveTrimmedVideoBlob', () => {
  it('writes to provided directory when file does not exist', async () => {
    const notFoundError = new DOMException('Not found', 'NotFoundError')

    const mockClose = vi.fn()
    const mockWrite = vi.fn()
    const mockWritable = { write: mockWrite, close: mockClose }
    const mockFileHandle = {
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    }

    const mockDirHandle = {
      getFileHandle: vi.fn().mockImplementation(
        (_name: string, options?: { create?: boolean }) => {
          if (options?.create === false) {
            return Promise.reject(notFoundError)
          }
          return Promise.resolve(mockFileHandle)
        }
      ),
    } as unknown as FileSystemDirectoryHandle

    const blob = new Blob(['data'], { type: 'video/mp4' })
    const result = await saveTrimmedVideoBlob(blob, 'clip.trimmed.mp4', mockDirHandle)

    expect(result).toBe('currentFolder')
    expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith('clip.trimmed.mp4', { create: false })
    expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith('clip.trimmed.mp4', { create: true })
    expect(mockWrite).toHaveBeenCalledWith(blob)
    expect(mockClose).toHaveBeenCalled()
  })

  it('falls back to picker when target file already exists', async () => {
    const mockExistingHandle = {} as FileSystemFileHandle
    const mockDirHandle = {
      getFileHandle: vi.fn().mockResolvedValue(mockExistingHandle),
    } as unknown as FileSystemDirectoryHandle

    const mockPickedWritable = { write: vi.fn(), close: vi.fn() }
    const mockPickedHandle = {
      createWritable: vi.fn().mockResolvedValue(mockPickedWritable),
    } as unknown as FileSystemFileHandle

    const showSaveFilePicker = vi.fn().mockResolvedValue(mockPickedHandle)
    // Stub window with showSaveFilePicker so the `'showSaveFilePicker' in window` check passes
    vi.stubGlobal('window', { showSaveFilePicker })

    const blob = new Blob(['data'], { type: 'video/mp4' })
    const result = await saveTrimmedVideoBlob(blob, 'clip.trimmed.mp4', mockDirHandle)

    expect(result).toBe('saveAsPicker')
    expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith('clip.trimmed.mp4', { create: false })
    expect(showSaveFilePicker).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

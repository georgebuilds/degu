export type TrimSaveLocation = 'currentFolder' | 'saveAsPicker'

/**
 * Write a trimmed video blob: try sibling folder (no extra picker), else Save As.
 */
export async function saveTrimmedVideoBlob(
  blob: Blob,
  suggestedName: string,
  directoryHandle: FileSystemDirectoryHandle | null
): Promise<TrimSaveLocation> {
  if (directoryHandle) {
    let shouldCreate = false
    try {
      await directoryHandle.getFileHandle(suggestedName, { create: false })
      // File exists — fall through to picker to avoid silent overwrite
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        shouldCreate = true
      } else {
        throw err
      }
    }
    if (shouldCreate) {
      try {
        const fh = await directoryHandle.getFileHandle(suggestedName, {
          create: true,
        })
        const w = await fh.createWritable()
        try {
          await w.write(blob)
        } finally {
          await w.close()
        }
        return 'currentFolder'
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          // Permission revoked between check and write — let caller fall back to picker.
          // Don't throw; the user explicitly opted into "save next to source" and a re-grant via the picker is the natural recovery.
        } else {
          throw err
        }
      }
    }
  }
  if (!('showSaveFilePicker' in window)) {
    throw new Error('Saving is not supported in this browser.')
  }
  const win = window as Window & {
    showSaveFilePicker: (
      options?: {
        suggestedName?: string
        types?: Array<{
          description: string
          accept: Record<string, string[]>
        }>
      }
    ) => Promise<FileSystemFileHandle>
  }
  const picked = await win.showSaveFilePicker({
    suggestedName,
    types: [
      {
        description: 'Video',
        accept: {
          'video/*': ['.mp4', '.webm', '.mov', '.mkv', '.m4v', '.avi'],
        },
      },
    ],
  })
  const writable = await picked.createWritable()
  try {
    await writable.write(blob)
  } finally {
    await writable.close()
  }
  return 'saveAsPicker'
}

export function trimmedFilenameSuggestion(originalName: string): string {
  const dot = originalName.lastIndexOf('.')
  if (dot <= 0) return `${originalName}.trimmed.mp4`
  const base = originalName.slice(0, dot)
  const ext = originalName.slice(dot)
  return `${base}.trimmed${ext}`
}

import { collectAllMediaRelativePaths } from './media-paths'
import { flushTagIndex, renameTagStorageKeysBatch } from './tags'
import { basenameFromRelativePath, isSupportedMediaFile } from './supported-media'

export type NormalizeProgress = {
  phase: 'collect' | 'run'
  done: number
  total: number
}

export type NormalizeFailure = { path: string; message: string }

export type NormalizeReport = {
  renamed: number
  unchanged: number
  skippedCollision: number
  skippedInvalid: number
  failed: NormalizeFailure[]
  /** Successful `oldPath` → `newPath` for UI (viewer, selection). */
  successfulRenames: { from: string; to: string }[]
  /** Non-null when on-disk tag index could not be flushed after renames; tags reference old keys. */
  tagIndexFlushError: string | null
}

export function normalizeBasename(name: string, removals: string[]): string {
  const parts = removals.filter(r => r.trim().length > 0)
  const dot = name.lastIndexOf('.')
  const hasExt = dot > 0
  let stem = hasExt ? name.slice(0, dot) : name
  const ext = hasExt ? name.slice(dot) : ''
  for (const r of parts) stem = stem.split(r).join('')
  stem = stem.trim()
  return stem + ext
}

type PlannedRename = {
  path: string
  parent: string
  oldBase: string
  newBase: string
}

function parentDirKey(relativePath: string): string {
  const i = relativePath.lastIndexOf('/')
  return i === -1 ? '' : relativePath.slice(0, i)
}

/** Chromium File System Access — same-directory rename. */
export async function renameFileToSameDirectory(
  fileHandle: FileSystemFileHandle,
  newName: string
): Promise<void> {
  const move = (fileHandle as FileSystemFileHandle & {
    move?: (name: string) => Promise<void>
  }).move
  if (typeof move !== 'function') {
    throw new Error(
      'Renaming files is not supported in this browser (FileSystemFileHandle.move).'
    )
  }
  await move.call(fileHandle, newName)
}

async function getFileHandleForPath(
  root: FileSystemDirectoryHandle,
  relativePath: string
): Promise<FileSystemFileHandle> {
  const parts = relativePath.split('/').filter(Boolean)
  if (parts.length === 0) throw new Error('Empty path')
  let dir: FileSystemDirectoryHandle = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!)
  }
  return dir.getFileHandle(parts[parts.length - 1]!)
}

export type RunNormalizeFilenamesOptions = {
  signal?: AbortSignal
  onProgress?: (p: NormalizeProgress) => void
}

/**
 * Rename supported media files under `root` by removing substrings from basenames,
 * update tag index keys, and flush `index.json`.
 */
export async function runNormalizeFilenames(
  root: FileSystemDirectoryHandle,
  removals: string[],
  options?: RunNormalizeFilenamesOptions
): Promise<NormalizeReport> {
  const signal = options?.signal
  const onProgress = options?.onProgress

  let collectDone = 0
  const paths = await collectAllMediaRelativePaths(root, {
    emitCollect: () => {
      collectDone++
      onProgress?.({ phase: 'collect', done: collectDone, total: 0 })
    },
  })

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const sorted = [...paths].sort((a, b) => a.localeCompare(b))

  // Lowercase to detect collisions on case-insensitive filesystems (macOS APFS default, exFAT, NTFS).
  const byParent = new Map<string, Set<string>>()
  for (const path of sorted) {
    const parent = parentDirKey(path)
    const base = basenameFromRelativePath(path)
    let set = byParent.get(parent)
    if (!set) {
      set = new Set()
      byParent.set(parent, set)
    }
    set.add(base.toLowerCase())
  }

  const state = new Map<string, Set<string>>()
  for (const [k, v] of byParent) {
    state.set(k, new Set(v))
  }

  const planned: PlannedRename[] = []
  let unchanged = 0
  let skippedCollision = 0
  let skippedInvalid = 0

  for (const path of sorted) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const parent = parentDirKey(path)
    const oldBase = basenameFromRelativePath(path)
    const newBase = normalizeBasename(oldBase, removals)

    if (newBase === oldBase) {
      unchanged++
      continue
    }

    // Empty stem: e.g. removing entire stem "vacation" from "vacation.jpg" → ".mp4"
    const newDot = newBase.lastIndexOf('.')
    const newStemEmpty = newDot > 0 && newBase.slice(0, newDot).length === 0

    if (!newBase || newStemEmpty || !isSupportedMediaFile(newBase)) {
      skippedInvalid++
      continue
    }

    const S = state.get(parent)
    if (!S?.has(oldBase.toLowerCase())) continue

    if (S.has(newBase.toLowerCase()) && newBase.toLowerCase() !== oldBase.toLowerCase()) {
      skippedCollision++
      continue
    }

    S.delete(oldBase.toLowerCase())
    S.add(newBase.toLowerCase())
    planned.push({ path, parent, oldBase, newBase })
  }

  const failed: NormalizeFailure[] = []
  const successfulRenames: { from: string; to: string }[] = []
  let renamed = 0
  const totalRun = planned.length

  for (let i = 0; i < planned.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { path, parent, newBase } = planned[i]!
    const newPath = parent === '' ? newBase : `${parent}/${newBase}`

    try {
      const fh = await getFileHandleForPath(root, path)
      await renameFileToSameDirectory(fh, newBase)
      successfulRenames.push({ from: path, to: newPath })
      renamed++
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      failed.push({ path, message })
    }

    onProgress?.({ phase: 'run', done: i + 1, total: totalRun })
  }

  renameTagStorageKeysBatch(successfulRenames)
  let tagIndexFlushError: string | null = null
  try {
    await flushTagIndex()
  } catch (e) {
    tagIndexFlushError = e instanceof Error ? e.message : String(e)
  }

  return {
    renamed,
    unchanged,
    skippedCollision,
    skippedInvalid,
    failed,
    successfulRenames,
    tagIndexFlushError,
  }
}

import type { FileListItem } from '../components/FileRow.tsx'

/**
 * Resolve a path relative to `root` (e.g. `src/app.php`) to a file row.
 */
export async function resolvePathToFileListItem(
  root: FileSystemDirectoryHandle,
  relativePath: string
): Promise<FileListItem> {
  const parts = relativePath.split('/').filter(Boolean)
  if (parts.length === 0) {
    throw new Error('Empty path')
  }
  let dir: FileSystemDirectoryHandle = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!)
  }
  const name = parts[parts.length - 1]!
  const fh = await dir.getFileHandle(name)
  const file = await fh.getFile()
  return {
    kind: 'file',
    name,
    tagStorageKey: relativePath,
    relativePath,
    handle: fh,
    size: file.size,
    lastModified: file.lastModified,
  }
}

/**
 * Parent directory and file name for a path relative to `root`, for
 * {@link FileSystemDirectoryHandle.removeEntry}.
 */
export async function resolveParentDirectoryAndFileName(
  root: FileSystemDirectoryHandle,
  relativePath: string
): Promise<{ parent: FileSystemDirectoryHandle; fileName: string }> {
  const parts = relativePath.split('/').filter(Boolean)
  if (parts.length === 0) {
    throw new Error('Empty path')
  }
  const fileName = parts[parts.length - 1]!
  let dir: FileSystemDirectoryHandle = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!)
  }
  return { parent: dir, fileName }
}

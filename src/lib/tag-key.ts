/**
 * Tag storage keys: path relative to the connected root folder, using `/`
 * (e.g. `src/app.php`). This distinguishes same-named files in different folders.
 */

export function tagStorageKeyForFileInStack(
  stack: FileSystemDirectoryHandle[],
  fileName: string
): string {
  const parts = stack.slice(1).map(h => h.name)
  parts.push(fileName)
  return parts.join('/')
}

/**
 * `pathRelativeToCurrentDir` is the path returned by a walk rooted at the
 * current directory (e.g. from name search), not including the current folder’s
 * name in the prefix.
 */
export function tagStorageKeyFromRootAndPathUnderCurrentDir(
  stack: FileSystemDirectoryHandle[],
  pathRelativeToCurrentDir: string
): string {
  const base = stack.slice(1).map(h => h.name).join('/')
  if (pathRelativeToCurrentDir === '') {
    return base
  }
  return base === '' ? pathRelativeToCurrentDir : `${base}/${pathRelativeToCurrentDir}`
}

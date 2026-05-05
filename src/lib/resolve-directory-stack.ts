/**
 * Walk from `root` into nested folders by name segments.
 */
export async function resolveDirectoryStack(
  root: FileSystemDirectoryHandle,
  segments: string[]
): Promise<FileSystemDirectoryHandle[]> {
  const stack: FileSystemDirectoryHandle[] = [root]
  for (const name of segments) {
    const parent = stack[stack.length - 1]!
    const dh = await parent.getDirectoryHandle(name)
    stack.push(dh)
  }
  return stack
}

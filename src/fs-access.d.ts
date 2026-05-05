export {}

/**
 * The DOM lib's FileSystem* types are missing a few methods that the SPA's
 * older code calls — `values()` notably. After the FSA → HTTP migration
 * (commit 3) the runtime objects are HttpDirectoryHandle / HttpFileHandle
 * shims, but their `FileSystemDirectoryHandle` / `FileSystemFileHandle` type
 * annotations carry through, so we still need this augmentation for the
 * compiler to accept the call sites.
 */
declare global {
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>
    queryPermission(descriptor?: {
      mode?: 'read' | 'readwrite'
    }): Promise<PermissionState>
    requestPermission(descriptor?: {
      mode?: 'read' | 'readwrite'
    }): Promise<PermissionState>
  }
}

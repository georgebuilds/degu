import { useEffect, useRef, useState } from 'preact/hooks'

export type BlobURLState = {
  /** URL to use as src; null while loading or on error. */
  url: string | null
  /** Non-null when getFile() rejected. Stable string for UI fallbacks. */
  error: string | null
}

/**
 * Loads a Blob URL for `handle` and revokes it on unmount or handle change.
 * Returns `{ url: null, error: null }` while loading, `{ url, error: null }`
 * on success, and `{ url: null, error: <message> }` if the file could not be
 * read (deleted, moved, permission revoked, etc).
 */
export function useFileBlobURL(handle: FileSystemFileHandle): BlobURLState {
  const [state, setState] = useState<BlobURLState>({ url: null, error: null })
  const urlRef = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setState({ url: null, error: null })
    void (async () => {
      try {
        const file = await handle.getFile()
        if (cancelled) return
        const u = URL.createObjectURL(file)
        urlRef.current = u
        setState({ url: u, error: null })
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'Could not read file'
        setState({ url: null, error: msg })
      }
    })()
    return () => {
      cancelled = true
      const u = urlRef.current
      if (u) {
        URL.revokeObjectURL(u)
        urlRef.current = null
      }
    }
  }, [handle])
  return state
}

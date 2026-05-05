/**
 * Hash-based path in the URL bar (e.g. #/photos/2024) without server support.
 * Segments are encodeURIComponent per piece so odd folder names round-trip.
 */

export function parseHashToSegments(): string[] {
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw || raw === '/') return []
  const trimmed = raw.startsWith('/') ? raw.slice(1) : raw
  if (!trimmed) return []
  return trimmed.split('/').filter(s => s !== '').map(s => {
    try { return decodeURIComponent(s) } catch { return s }
  })
}

/** Path under root: [] = root, ['a','b'] = root/a/b */
export function encodePathSegments(segments: string[]): string {
  if (segments.length === 0) return '/'
  return '/' + segments.map(s => encodeURIComponent(s)).join('/')
}

export function hashUrlFromSegments(segments: string[]): string {
  const path = encodePathSegments(segments)
  return `${window.location.pathname}${window.location.search}#${path}`
}

export function stackHandlesToSegments(
  stack: FileSystemDirectoryHandle[]
): string[] {
  return stack.slice(1).map(h => h.name)
}

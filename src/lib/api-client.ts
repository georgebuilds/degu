/**
 * Typed wrappers around the local degu HTTP API. Keep this file dependency-free
 * — it gets imported from many places, including the FSA-shaped shims that
 * back the legacy component code.
 */

export type ScanEntry = {
  path: string
  name: string
  size: number
  modTime: number
  kind: 'image' | 'video'
}

export type ScanResponse = {
  root: string
  entries: ScanEntry[]
}

export type StatsKindBreakdown = { image: number; video: number }
export type StatsExtension = { ext: string; bytes: number; files: number }
export type StatsTagBreakdown = { tag: string; bytes: number; files: number }
export type StatsResponse = {
  totalBytes: number
  totalFiles: number
  byKind: StatsKindBreakdown
  byExt: StatsExtension[]
  byTag: StatsTagBreakdown[]
}

export type InfoResponse = {
  version: string
  root: string
}

const JSON_HEADERS: HeadersInit = { 'Content-Type': 'application/json' }

async function expectOk(res: Response, label: string): Promise<Response> {
  if (!res.ok) {
    let detail = res.statusText
    try {
      const j = (await res.json()) as { error?: string }
      if (j?.error) detail = j.error
    } catch {
      /* body wasn't JSON */
    }
    throw new Error(`${label}: ${res.status} ${detail}`)
  }
  return res
}

/** Forward-slash relative path → URL path with each segment encoded. */
export function encodePath(rel: string): string {
  return rel.split('/').map(encodeURIComponent).join('/')
}

export function fileURL(rel: string): string {
  return `/api/file/${encodePath(rel)}`
}

export function thumbURL(rel: string, width = 256): string {
  return `/api/thumb/${encodePath(rel)}?w=${width}`
}

export async function getInfo(): Promise<InfoResponse> {
  const r = await fetch('/api/info', { headers: { Accept: 'application/json' } })
  await expectOk(r, 'GET /api/info')
  return r.json()
}

export async function scanRoot(): Promise<ScanResponse> {
  const r = await fetch('/api/scan', { headers: { Accept: 'application/json' } })
  await expectOk(r, 'GET /api/scan')
  return r.json()
}

export async function fetchStats(): Promise<StatsResponse> {
  const r = await fetch('/api/stats', { headers: { Accept: 'application/json' } })
  await expectOk(r, 'GET /api/stats')
  return r.json()
}

export async function fetchFile(rel: string): Promise<Blob> {
  const r = await fetch(fileURL(rel))
  await expectOk(r, `GET ${fileURL(rel)}`)
  return r.blob()
}

export async function deleteFile(rel: string): Promise<void> {
  const r = await fetch(fileURL(rel), { method: 'DELETE' })
  await expectOk(r, `DELETE ${fileURL(rel)}`)
}

export async function moveFile(from: string, to: string): Promise<void> {
  const r = await fetch('/api/move', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ from, to }),
  })
  await expectOk(r, 'POST /api/move')
}

export async function moveBatch(
  pairs: ReadonlyArray<{ from: string; to: string }>
): Promise<void> {
  const r = await fetch('/api/move/batch', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ moves: pairs }),
  })
  await expectOk(r, 'POST /api/move/batch')
}

export type SaveOptions = {
  /** When true, allow overwriting an existing file at this path. */
  overwrite?: boolean
}

export async function saveFile(
  rel: string,
  body: Blob | ArrayBuffer | Uint8Array,
  opts: SaveOptions = {}
): Promise<{ path: string; size: number }> {
  const url = `/api/save/${encodePath(rel)}${opts.overwrite ? '?overwrite=1' : ''}`
  const init: RequestInit = { method: 'PUT', body: body as BodyInit }
  const r = await fetch(url, init)
  await expectOk(r, `PUT ${url}`)
  return r.json()
}

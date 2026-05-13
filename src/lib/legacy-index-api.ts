/**
 * Client for the /api/legacy-index/* endpoints. Server-side details live in
 * internal/api/legacy_import.go; this file shapes the over-the-wire format
 * into TS-friendly types and consumes the SSE stream via fetch().
 */

export type LegacyIndexStatus = {
  available: boolean
  /** Distinct-path count after canonicalisation; only meaningful when available. */
  entryCount: number
}

export type ImportPhase = 'verifying' | 'saving' | 'done'

export type ImportProgress = {
  phase: ImportPhase
  done: number
  total: number
}

export type ImportResult = {
  imported: number
  missing: string[]
  skippedMalformed: number
}

export async function fetchLegacyIndexStatus(
  signal?: AbortSignal
): Promise<LegacyIndexStatus> {
  const r = await fetch('/api/legacy-index/status', { signal })
  if (!r.ok) {
    throw new Error(`GET /api/legacy-index/status: ${r.status}`)
  }
  return (await r.json()) as LegacyIndexStatus
}

type ImportStreamHandlers = {
  onProgress: (p: ImportProgress) => void
  signal?: AbortSignal
}

type WireEvent =
  | { type: 'progress'; progress: ImportProgress }
  | { type: 'result'; result: ImportResult }
  | { type: 'error'; error: string }

/**
 * Start the import and stream progress events until completion. Resolves with
 * the final result; rejects on transport error or on an explicit error event
 * from the server.
 *
 * The server returns text/event-stream — each event is a single line of
 * `data: <json>` followed by a blank line. We don't need EventSource (which is
 * GET-only); a fetch + ReadableStream + TextDecoder line-splitter is enough.
 */
export async function streamLegacyIndexImport(
  handlers: ImportStreamHandlers
): Promise<ImportResult> {
  const r = await fetch('/api/legacy-index/import', {
    method: 'POST',
    signal: handlers.signal,
  })
  if (!r.ok || !r.body) {
    throw new Error(`POST /api/legacy-index/import: ${r.status}`)
  }
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let finalResult: ImportResult | null = null
  let serverError: string | null = null

  // SSE frames are separated by a blank line; lines within a frame may
  // include `data: <chunk>` continuations. We only ever emit one `data:`
  // per frame, so the parser just collects lines until \n\n and pulls the
  // single payload out.
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let frameEnd: number
    while ((frameEnd = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, frameEnd)
      buf = buf.slice(frameEnd + 2)
      const dataLine = frame
        .split('\n')
        .find(l => l.startsWith('data: '))
      if (!dataLine) continue
      const payload = dataLine.slice('data: '.length)
      let ev: WireEvent
      try {
        ev = JSON.parse(payload) as WireEvent
      } catch {
        continue
      }
      if (ev.type === 'progress') {
        handlers.onProgress(ev.progress)
      } else if (ev.type === 'result') {
        finalResult = ev.result
      } else if (ev.type === 'error') {
        serverError = ev.error
      }
    }
  }

  if (serverError) throw new Error(serverError)
  if (!finalResult) throw new Error('legacy import: stream ended without a result')
  return finalResult
}

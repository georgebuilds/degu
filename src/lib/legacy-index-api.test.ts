import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchLegacyIndexStatus,
  streamLegacyIndexImport,
  type ImportProgress,
} from './legacy-index-api'

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  }
}

/** Build a Response-like object whose body streams the given UTF-8 chunks. */
function sseResponse(
  chunks: string[],
  init?: { ok?: boolean; status?: number; nullBody?: boolean },
) {
  const encoder = new TextEncoder()
  let i = 0
  const reader = {
    read: async () => {
      if (i >= chunks.length) return { value: undefined, done: true }
      const value = encoder.encode(chunks[i])
      i += 1
      return { value, done: false }
    },
  }
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    body: init?.nullBody ? null : { getReader: () => reader },
  }
}

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`

describe('fetchLegacyIndexStatus', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('returns the parsed status on a 200', async () => {
    const status = { available: true, entryCount: 42 }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(status))

    await expect(fetchLegacyIndexStatus()).resolves.toEqual(status)
    expect(fetch).toHaveBeenCalledWith('/api/legacy-index/status', {
      signal: undefined,
    })
  })

  it('forwards an abort signal', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ available: false, entryCount: 0 }),
    )
    const ctrl = new AbortController()
    await fetchLegacyIndexStatus(ctrl.signal)
    expect(fetch).toHaveBeenCalledWith('/api/legacy-index/status', {
      signal: ctrl.signal,
    })
  })

  it('throws on a non-OK response', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(null, { ok: false, status: 503 }),
    )
    await expect(fetchLegacyIndexStatus()).rejects.toThrow(
      'GET /api/legacy-index/status: 503',
    )
  })
})

describe('streamLegacyIndexImport', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('emits progress events and resolves with the final result', async () => {
    const result = { imported: 3, missing: ['a.mp4'], skippedMalformed: 1 }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([
        frame({ type: 'progress', progress: { phase: 'verifying', done: 1, total: 3 } }),
        frame({ type: 'progress', progress: { phase: 'saving', done: 3, total: 3 } }),
        frame({ type: 'result', result }),
      ]),
    )

    const seen: ImportProgress[] = []
    const out = await streamLegacyIndexImport({ onProgress: p => seen.push(p) })

    expect(out).toEqual(result)
    expect(seen).toEqual([
      { phase: 'verifying', done: 1, total: 3 },
      { phase: 'saving', done: 3, total: 3 },
    ])
    expect(fetch).toHaveBeenCalledWith('/api/legacy-index/import', {
      method: 'POST',
      signal: undefined,
    })
  })

  it('reassembles frames split across chunk boundaries', async () => {
    const result = { imported: 1, missing: [], skippedMalformed: 0 }
    const full = frame({ type: 'result', result })
    const cut = Math.floor(full.length / 2)
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([full.slice(0, cut), full.slice(cut)]),
    )
    await expect(
      streamLegacyIndexImport({ onProgress: () => {} }),
    ).resolves.toEqual(result)
  })

  it('ignores frames without a data: line and skips unparseable JSON', async () => {
    const result = { imported: 0, missing: [], skippedMalformed: 0 }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([
        'event: ping\n\n',
        'data: {not json}\n\n',
        frame({ type: 'result', result }),
      ]),
    )
    await expect(
      streamLegacyIndexImport({ onProgress: () => {} }),
    ).resolves.toEqual(result)
  })

  it('rejects with the server error event message', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([frame({ type: 'error', error: 'disk full' })]),
    )
    await expect(
      streamLegacyIndexImport({ onProgress: () => {} }),
    ).rejects.toThrow('disk full')
  })

  it('rejects when the stream ends without a result', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([
        frame({ type: 'progress', progress: { phase: 'done', done: 1, total: 1 } }),
      ]),
    )
    await expect(
      streamLegacyIndexImport({ onProgress: () => {} }),
    ).rejects.toThrow('legacy import: stream ended without a result')
  })

  it('throws on a non-OK response', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([], { ok: false, status: 500 }),
    )
    await expect(
      streamLegacyIndexImport({ onProgress: () => {} }),
    ).rejects.toThrow('POST /api/legacy-index/import: 500')
  })

  it('throws when the response has no body', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      sseResponse([], { nullBody: true }),
    )
    await expect(
      streamLegacyIndexImport({ onProgress: () => {} }),
    ).rejects.toThrow('POST /api/legacy-index/import: 200')
  })
})

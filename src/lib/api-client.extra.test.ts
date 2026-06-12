import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyUpdate,
  checkForUpdate,
  deleteFile,
  encodePath,
  fetchFile,
  fetchStats,
  fileURL,
  getInfo,
  moveBatch,
  moveFile,
  saveFile,
  scanRoot,
  thumbURL,
} from './api-client'

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('URL helpers', () => {
  it('encodePath encodes each segment but keeps slashes', () => {
    expect(encodePath('a/b c/d&e.png')).toBe('a/b%20c/d%26e.png')
  })

  it('fileURL and thumbURL build encoded paths', () => {
    expect(fileURL('dir/x y.png')).toBe('/api/file/dir/x%20y.png')
    expect(thumbURL('dir/x y.png')).toBe('/api/thumb/dir/x%20y.png?w=256')
    expect(thumbURL('a.png', 512)).toBe('/api/thumb/a.png?w=512')
  })
})

describe('getInfo', () => {
  it('returns parsed JSON on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ version: '1.2.3', root: '/media' })
    )
    await expect(getInfo()).resolves.toEqual({ version: '1.2.3', root: '/media' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/info',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    )
  })

  it('throws with the server error detail on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'no root connected' }, { status: 503 })
    )
    await expect(getInfo()).rejects.toThrow('GET /api/info: 503 no root connected')
  })

  it('falls back to statusText when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>nope</html>', {
        status: 500,
        statusText: 'Internal Server Error',
      })
    )
    await expect(getInfo()).rejects.toThrow(
      'GET /api/info: 500 Internal Server Error'
    )
  })

  it('forwards the abort signal', async () => {
    const ctrl = new AbortController()
    fetchMock.mockResolvedValueOnce(jsonResponse({ version: 'v', root: '/r' }))
    await getInfo(ctrl.signal)
    expect(fetchMock.mock.calls[0][1].signal).toBe(ctrl.signal)
  })
})

describe('checkForUpdate', () => {
  it('returns parsed JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ current: '1.0.0', updateAvailable: false })
    )
    await expect(checkForUpdate()).resolves.toEqual({
      current: '1.0.0',
      updateAvailable: false,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/check-update', expect.anything())
  })

  it('throws on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'rate limited' }, { status: 429 })
    )
    await expect(checkForUpdate()).rejects.toThrow(
      'GET /api/check-update: 429 rate limited'
    )
  })
})

describe('applyUpdate', () => {
  it('POSTs and returns the result', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, newVersion: '2.0.0' })
    )
    await expect(applyUpdate()).resolves.toEqual({
      success: true,
      newVersion: '2.0.0',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/apply-update',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws on failure', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'update failed' }, { status: 500 })
    )
    await expect(applyUpdate()).rejects.toThrow(
      'POST /api/apply-update: 500 update failed'
    )
  })
})

describe('scanRoot', () => {
  it('returns the scan response and applies a default timeout', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ root: '/r', entries: [] })
    )
    await expect(scanRoot()).resolves.toEqual({ root: '/r', entries: [] })
    // A combined timeout signal is passed even without a caller signal.
    const passed = fetchMock.mock.calls[0][1].signal as AbortSignal
    expect(passed).toBeInstanceOf(AbortSignal)
    expect(passed.aborted).toBe(false)
  })

  it('clears the timeout when the request fails (finally branch)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'scan broke' }, { status: 500 })
    )
    await expect(scanRoot()).rejects.toThrow('GET /api/scan: 500 scan broke')
  })

  it('combines a caller signal with the timeout', async () => {
    const ctrl = new AbortController()
    fetchMock.mockResolvedValueOnce(jsonResponse({ root: '/r', entries: [] }))
    await scanRoot(ctrl.signal)
    const passed = fetchMock.mock.calls[0][1].signal as AbortSignal
    // It is a derived signal, not the caller's own.
    expect(passed).not.toBe(ctrl.signal)
    expect(passed.aborted).toBe(false)
  })
})

describe('fetchStats', () => {
  it('returns parsed stats', async () => {
    const stats = {
      totalBytes: 10,
      totalFiles: 2,
      byKind: { image: 1, video: 1 },
      byExt: [],
      byTag: [],
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(stats))
    await expect(fetchStats()).resolves.toEqual(stats)
  })

  it('throws on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'stats failed' }, { status: 500 })
    )
    await expect(fetchStats()).rejects.toThrow('GET /api/stats: 500 stats failed')
  })
})

describe('fetchFile', () => {
  it('returns the blob body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('hello', { status: 200 })
    )
    const blob = await fetchFile('dir/a.png')
    expect(await blob.text()).toBe('hello')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/file/dir/a.png',
      expect.anything()
    )
  })

  it('throws on a non-ok response using the encoded URL in the label', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 404, statusText: 'Not Found' })
    )
    await expect(fetchFile('x y.png')).rejects.toThrow(
      'GET /api/file/x%20y.png: 404 Not Found'
    )
  })
})

describe('deleteFile', () => {
  it('issues a DELETE and resolves on success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(deleteFile('a.png')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/file/a.png',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('throws on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'locked' }, { status: 423 })
    )
    await expect(deleteFile('a.png')).rejects.toThrow(
      'DELETE /api/file/a.png: 423 locked'
    )
  })
})

describe('moveFile', () => {
  it('POSTs the from/to body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
    await expect(moveFile('a.png', 'b.png')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'a.png', to: 'b.png' }),
    })
  })

  it('throws on failure', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'exists' }, { status: 409 })
    )
    await expect(moveFile('a.png', 'b.png')).rejects.toThrow(
      'POST /api/move: 409 exists'
    )
  })
})

describe('moveBatch', () => {
  it('POSTs the moves array', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
    const pairs = [{ from: 'a', to: 'b' }]
    await expect(moveBatch(pairs)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/move/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves: pairs }),
    })
  })

  it('throws on failure', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'partial' }, { status: 500 })
    )
    await expect(moveBatch([{ from: 'a', to: 'b' }])).rejects.toThrow(
      'POST /api/move/batch: 500 partial'
    )
  })
})

describe('saveFile', () => {
  it('PUTs the body and returns the parsed result', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ path: 'a.png', size: 42 })
    )
    const body = new Blob(['data'])
    await expect(saveFile('a.png', body)).resolves.toEqual({
      path: 'a.png',
      size: 42,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/save/a.png')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(body)
  })

  it('appends the overwrite query when opts.overwrite is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ path: 'x y.png', size: 1 }))
    await saveFile('x y.png', new Uint8Array([1]), { overwrite: true })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/save/x%20y.png?overwrite=1')
  })

  it('throws on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'exists' }, { status: 409 })
    )
    await expect(saveFile('a.png', new Blob(['x']))).rejects.toThrow(
      'PUT /api/save/a.png: 409 exists'
    )
  })
})

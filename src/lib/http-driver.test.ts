import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HttpDriver } from './http-driver'
import type { TagPayload } from './storage-driver'

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}
function notOk(status: number) {
  return { ok: false, status, json: async () => ({}) }
}

const emptyPayload: TagPayload = {
  tags: {},
  videoLoops: {},
  tagCreatedAt: {},
  lastReviewed: {},
}

describe('HttpDriver.detect', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('returns a driver whose rootName is the last path segment of root', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ root: '/home/me/Media/' }),
    )
    const driver = await HttpDriver.detect()
    expect(driver).toBeInstanceOf(HttpDriver)
    expect(driver?.kind).toBe('http')
    expect(driver?.rootName).toBe('Media')
    expect(driver?.rootHandle).toBeDefined()
    expect(fetch).toHaveBeenCalledWith(
      '/api/info',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
  })

  it('uses a single-segment root verbatim', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(ok({ root: 'media' }))
    const driver = await HttpDriver.detect()
    expect(driver?.rootName).toBe('media')
  })

  it('returns null on a non-OK response', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(notOk(404))
    await expect(HttpDriver.detect()).resolves.toBeNull()
  })

  it('returns null when root is not a string', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(ok({ root: 123 }))
    await expect(HttpDriver.detect()).resolves.toBeNull()
  })

  it('returns null on a network error', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))
    await expect(HttpDriver.detect()).resolves.toBeNull()
  })
})

describe('HttpDriver.loadTags', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  async function makeDriver(): Promise<HttpDriver> {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      ok({ root: '/r' }),
    )
    const d = await HttpDriver.detect()
    return d as HttpDriver
  }

  it('reshapes the flat wire payload through parseIndexPayload', async () => {
    const driver = await makeDriver()
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      ok({
        tags: { 'a.mp4': ['fav'] },
        videoLoops: {},
        tagCreatedAt: {},
        lastReviewed: {},
      }),
    )
    const out = await driver.loadTags()
    expect(out.tags).toEqual({ 'a.mp4': ['fav'] })
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/tags',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
  })

  it('tolerates a payload with missing optional fields', async () => {
    const driver = await makeDriver()
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok({}))
    const out = await driver.loadTags()
    expect(out.tags).toEqual({})
  })

  it('throws on a non-OK response', async () => {
    const driver = await makeDriver()
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(notOk(500))
    await expect(driver.loadTags()).rejects.toThrow('GET /api/tags: 500')
  })
})

describe('HttpDriver.saveTags', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  async function makeDriver(): Promise<HttpDriver> {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      ok({ root: '/r' }),
    )
    return (await HttpDriver.detect()) as HttpDriver
  }

  it('PUTs the JSON body and resolves on success', async () => {
    const driver = await makeDriver()
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
    })
    await driver.saveTags({ ...emptyPayload, tags: { 'x.mp4': ['t'] } })
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!
    expect(call[0]).toBe('/api/tags')
    expect(call[1].method).toBe('PUT')
    expect(call[1].headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(call[1].body)).toEqual({
      tags: { 'x.mp4': ['t'] },
      videoLoops: {},
      tagCreatedAt: {},
      lastReviewed: {},
    })
  })

  it('throws on a non-OK PUT', async () => {
    const driver = await makeDriver()
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 422,
    })
    await expect(driver.saveTags(emptyPayload)).rejects.toThrow(
      'PUT /api/tags: 422',
    )
  })

  it('keepalive path: small body uses fetch keepalive PUT', async () => {
    const driver = await makeDriver()
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
    })
    await driver.saveTags(emptyPayload, { keepalive: true })
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!
    expect(call[1].keepalive).toBe(true)
    expect(call[1].method).toBe('PUT')
  })

  it('keepalive path: small body throws on non-OK', async () => {
    const driver = await makeDriver()
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
    })
    await expect(
      driver.saveTags(emptyPayload, { keepalive: true }),
    ).rejects.toThrow('PUT /api/tags: 500')
  })

  it('keepalive path: oversized body uses sendBeacon (success)', async () => {
    const driver = await makeDriver()
    const sendBeacon = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { sendBeacon })

    // > 64KiB body to force the beacon branch.
    const bigTags: Record<string, string[]> = {}
    for (let i = 0; i < 4000; i++) bigTags[`file-${i}.mp4`] = ['tag']
    await driver.saveTags({ ...emptyPayload, tags: bigTags }, { keepalive: true })

    expect(sendBeacon).toHaveBeenCalledTimes(1)
    expect(sendBeacon.mock.calls[0][0]).toBe('/api/tags')
    expect(sendBeacon.mock.calls[0][1]).toBeInstanceOf(Blob)
  })

  it('keepalive path: oversized body throws when sendBeacon is rejected', async () => {
    const driver = await makeDriver()
    vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(false) })
    const bigTags: Record<string, string[]> = {}
    for (let i = 0; i < 4000; i++) bigTags[`file-${i}.mp4`] = ['tag']
    await expect(
      driver.saveTags({ ...emptyPayload, tags: bigTags }, { keepalive: true }),
    ).rejects.toThrow('sendBeacon /api/tags rejected')
  })
})

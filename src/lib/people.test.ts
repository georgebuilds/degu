import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFaceRegion,
  createPerson,
  deleteFaceRegion,
  deletePerson,
  getPeopleVersion,
  listFaceRegions,
  listFaceRegionsByPerson,
  listPeople,
  renamePerson,
  subscribePeopleVersion,
  updateFaceRegion,
} from './people.ts'

type FetchCall = { url: string; init?: RequestInit }

let calls: FetchCall[]

function mockFetchOnce(response: {
  ok?: boolean
  status?: number
  json?: unknown
  text?: string
}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json ?? {},
      text: async () => response.text ?? '',
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  calls = []
  // Reset the in-memory people cache by deleting then re-listing is not
  // exposed; instead each list test sets up its own fetch first.
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('version / subscription', () => {
  it('starts at a numeric version and bumps on writes', async () => {
    const before = getPeopleVersion()
    mockFetchOnce({ json: { id: 1, name: 'Ada', createdAt: 'now' } })
    await createPerson('Ada')
    expect(getPeopleVersion()).toBe(before + 1)
  })

  it('notifies and can unsubscribe listeners', async () => {
    const fn = vi.fn()
    const unsub = subscribePeopleVersion(fn)
    mockFetchOnce({ json: { id: 2, name: 'Grace', createdAt: 'now' } })
    await createPerson('Grace')
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
    mockFetchOnce({ json: { id: 3, name: 'Linus', createdAt: 'now' } })
    await createPerson('Linus')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('listPeople caching', () => {
  it('fetches on first call and caches subsequent calls', async () => {
    const people = [{ id: 1, name: 'Ada', createdAt: 'now' }]
    const fetchMock = mockFetchOnce({ json: people })
    const first = await listPeople()
    expect(first).toEqual(people)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Second call should hit the cache, no new fetch.
    const second = await listPeople()
    expect(second).toEqual(people)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls[0]!.url).toBe('/api/people')
  })

  it('invalidates the cache after a write so the next list refetches', async () => {
    mockFetchOnce({ json: [{ id: 1, name: 'Ada', createdAt: 'now' }] })
    await listPeople()
    // createPerson clears the cache.
    mockFetchOnce({ json: { id: 9, name: 'New', createdAt: 'now' } })
    await createPerson('New')

    const refetched = [{ id: 1, name: 'Ada', createdAt: 'now' }, { id: 9, name: 'New', createdAt: 'now' }]
    const fetchMock = mockFetchOnce({ json: refetched })
    const result = await listPeople()
    expect(result).toEqual(refetched)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('people CRUD', () => {
  it('createPerson POSTs JSON body', async () => {
    const fetchMock = mockFetchOnce({ json: { id: 1, name: 'Ada', createdAt: 'now' } })
    const p = await createPerson('Ada')
    expect(p.name).toBe('Ada')
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Ada' })
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('renamePerson PUTs to the id path', async () => {
    const fetchMock = mockFetchOnce({ json: { id: 7, name: 'Bea', createdAt: 'now' } })
    const p = await renamePerson(7, 'Bea')
    expect(p.name).toBe('Bea')
    expect(calls[0]!.url).toBe('/api/people/7')
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('PUT')
  })

  it('deletePerson DELETEs the id path', async () => {
    const fetchMock = mockFetchOnce({ json: { ok: true } })
    await deletePerson(42)
    expect(calls[0]!.url).toBe('/api/people/42')
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('DELETE')
  })
})

describe('face regions API', () => {
  it('listFaceRegions encodes the path query', async () => {
    mockFetchOnce({ json: [] })
    await listFaceRegions('a b/c&d.jpg')
    expect(calls[0]!.url).toBe(`/api/faces?path=${encodeURIComponent('a b/c&d.jpg')}`)
  })

  it('listFaceRegionsByPerson hits the by-person path', async () => {
    mockFetchOnce({ json: [] })
    await listFaceRegionsByPerson(5)
    expect(calls[0]!.url).toBe('/api/faces/by-person/5')
  })

  it('createFaceRegion POSTs input and bumps version', async () => {
    const before = getPeopleVersion()
    const fetchMock = mockFetchOnce({
      json: { id: 1, relPath: 'p.jpg', personId: null, x: null, y: null, w: null, h: null, source: 'manual', confidence: null },
    })
    const r = await createFaceRegion({ relPath: 'p.jpg' })
    expect(r.id).toBe(1)
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST')
    expect(getPeopleVersion()).toBe(before + 1)
  })

  it('updateFaceRegion PUTs to the id path and bumps version', async () => {
    const before = getPeopleVersion()
    mockFetchOnce({
      json: { id: 3, relPath: 'p.jpg', personId: 2, x: 1, y: 2, w: 3, h: 4, source: 'confirmed', confidence: 0.9 },
    })
    const r = await updateFaceRegion(3, { personId: 2 })
    expect(r.personId).toBe(2)
    expect(calls[0]!.url).toBe('/api/faces/3')
    expect(getPeopleVersion()).toBe(before + 1)
  })

  it('deleteFaceRegion DELETEs and bumps version', async () => {
    const before = getPeopleVersion()
    mockFetchOnce({ json: { ok: true } })
    await deleteFaceRegion(8)
    expect(calls[0]!.url).toBe('/api/faces/8')
    expect(getPeopleVersion()).toBe(before + 1)
  })
})

describe('api error handling', () => {
  it('throws with method, path, status and body text on non-ok', async () => {
    mockFetchOnce({ ok: false, status: 500, text: 'boom' })
    await expect(createPerson('x')).rejects.toThrow('POST /api/people: 500 boom')
  })

  it('tolerates a text() that rejects (falls back to empty body)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => {
        throw new Error('no body')
      },
    } as unknown as Response))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listFaceRegionsByPerson(1)).rejects.toThrow('GET /api/faces/by-person/1: 404')
  })

  it('aborts the request after the timeout elapses', async () => {
    vi.useFakeTimers()
    let capturedSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      return new Promise<Response>(() => {
        // never resolves; we only inspect the abort signal
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    // Fire and forget; we only check the signal toggles after the timeout.
    void listFaceRegionsByPerson(99).catch(() => {})
    expect(capturedSignal?.aborted).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(capturedSignal?.aborted).toBe(true)
  })
})

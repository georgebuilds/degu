import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  loadStoredRootHandle,
  saveRootHandle,
  clearStoredRootHandle,
} from './handle-store'

/**
 * Minimal in-memory fake of the IndexedDB surface handle-store.ts uses:
 * indexedDB.open -> request with on{upgradeneeded,success,error}; a DB with
 * objectStoreNames.contains / createObjectStore / transaction / close; and an
 * object store exposing get / put / delete as async-style IDBRequests.
 *
 * Each request fires its callback on a microtask so the module's promise
 * plumbing (which assigns onsuccess after open() returns) sees it.
 */

type Mode = 'success' | 'openError' | 'requestError'

function makeRequest<T>(run: () => T, mode: Mode) {
  const req: any = { onsuccess: null, onerror: null, result: undefined, error: undefined }
  queueMicrotask(() => {
    if (mode === 'requestError') {
      req.error = new Error('request failed')
      req.onerror?.()
      return
    }
    req.result = run()
    req.onsuccess?.()
  })
  return req
}

function installFakeIndexedDb(options?: {
  initialRoot?: unknown
  hasStore?: boolean
  mode?: Mode
}) {
  const store = new Map<string, unknown>()
  if (options?.initialRoot !== undefined) store.set('root', options.initialRoot)
  const mode = options?.mode ?? 'success'
  const closed = { value: false }

  const objectStore = {
    get: (key: string) => makeRequest(() => store.get(key), mode),
    put: (val: unknown, key: string) =>
      makeRequest(() => {
        store.set(key, val)
        return undefined
      }, mode),
    delete: (key: string) =>
      makeRequest(() => {
        store.delete(key)
        return undefined
      }, mode),
  }

  const db: any = {
    objectStoreNames: { contains: () => options?.hasStore ?? true },
    createObjectStore: vi.fn(),
    transaction: () => ({ objectStore: () => objectStore }),
    close: () => {
      closed.value = true
    },
  }

  const indexedDB = {
    open: () => {
      const req: any = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        result: db,
        error: undefined,
      }
      queueMicrotask(() => {
        if (mode === 'openError') {
          req.error = new Error('open failed')
          req.onerror?.()
          return
        }
        req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
  }

  vi.stubGlobal('indexedDB', indexedDB)
  return { store, db, closed }
}

afterEach(() => vi.unstubAllGlobals())

describe('loadStoredRootHandle', () => {
  it('returns the stored handle', async () => {
    const handle = { kind: 'directory', name: 'Media' }
    installFakeIndexedDb({ initialRoot: handle })
    await expect(loadStoredRootHandle()).resolves.toBe(handle)
  })

  it('returns null when nothing is stored', async () => {
    installFakeIndexedDb()
    await expect(loadStoredRootHandle()).resolves.toBeNull()
  })

  it('creates the object store during upgrade when missing', async () => {
    const { db } = installFakeIndexedDb({ hasStore: false })
    await loadStoredRootHandle()
    expect(db.createObjectStore).toHaveBeenCalledWith('handles')
  })

  it('does not re-create the store when it already exists', async () => {
    const { db } = installFakeIndexedDb({ hasStore: true })
    await loadStoredRootHandle()
    expect(db.createObjectStore).not.toHaveBeenCalled()
  })

  it('returns null (swallows) when open fails', async () => {
    installFakeIndexedDb({ mode: 'openError' })
    await expect(loadStoredRootHandle()).resolves.toBeNull()
  })

  it('returns null (swallows) when the get request errors', async () => {
    installFakeIndexedDb({ mode: 'requestError' })
    await expect(loadStoredRootHandle()).resolves.toBeNull()
  })

  it('closes the db after the transaction', async () => {
    const { closed } = installFakeIndexedDb({ initialRoot: { x: 1 } })
    await loadStoredRootHandle()
    expect(closed.value).toBe(true)
  })
})

describe('saveRootHandle', () => {
  it('persists the handle under the root key', async () => {
    const { store } = installFakeIndexedDb()
    const handle = { kind: 'directory', name: 'Vids' }
    await saveRootHandle(handle as unknown as FileSystemDirectoryHandle)
    expect(store.get('root')).toBe(handle)
  })

  it('swallows errors (best-effort) when IndexedDB is unavailable', async () => {
    installFakeIndexedDb({ mode: 'openError' })
    await expect(
      saveRootHandle({} as FileSystemDirectoryHandle),
    ).resolves.toBeUndefined()
  })
})

describe('clearStoredRootHandle', () => {
  it('deletes the stored handle', async () => {
    const { store } = installFakeIndexedDb({ initialRoot: { a: 1 } })
    await clearStoredRootHandle()
    expect(store.has('root')).toBe(false)
  })

  it('swallows errors (best-effort)', async () => {
    installFakeIndexedDb({ mode: 'requestError' })
    await expect(clearStoredRootHandle()).resolves.toBeUndefined()
  })
})

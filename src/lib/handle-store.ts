/**
 * IndexedDB-backed persistence for the FSA root directory handle.
 *
 * `FileSystemDirectoryHandle` is structured-cloneable, so IndexedDB stores
 * it natively across reloads. On boot the SPA queries permission against
 * the stored handle:
 *
 *   - `granted` → reuse the handle, no prompt needed.
 *   - `prompt`  → caller renders a "reconnect this folder" button; the
 *                 click handler calls `reconnect()` to request permission.
 *   - `denied`  → drop the stored handle, fall through to `pickFolder()`.
 *
 * Only used by FsaDriver. HttpDriver does not need this — the Go server tells
 * the SPA which root it's scoped to via `/api/info`.
 */

const DB_NAME = 'degu-fsa'
const DB_VERSION = 1
const STORE_NAME = 'handles'
const ROOT_KEY = 'root'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      const req = fn(tx.objectStore(STORE_NAME))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function loadStoredRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await withStore('readonly', store => store.get(ROOT_KEY))
    return (handle as FileSystemDirectoryHandle | undefined) ?? null
  } catch {
    return null
  }
}

export async function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await withStore('readwrite', store => store.put(handle, ROOT_KEY))
  } catch {
    // IndexedDB blocked / unavailable (e.g. private mode) — best-effort.
  }
}

export async function clearStoredRootHandle(): Promise<void> {
  try {
    await withStore('readwrite', store => store.delete(ROOT_KEY))
  } catch {
    /* best-effort */
  }
}

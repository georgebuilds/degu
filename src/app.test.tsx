/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegacyIndexStatus } from './lib/legacy-index-api.ts'

// ---- hoisted mock state ----------------------------------------------------

const mocks = vi.hoisted(() => ({
  // HttpDriver.detect outcome
  httpDriver: null as { rootHandle: { name: string } } | null,
  // fetchLegacyIndexStatus outcome
  legacyStatus: { available: false, entryCount: 0 } as LegacyIndexStatus,
  legacyThrows: false,
  // fsa support
  fsaSupported: false,
  // stored handle (loadStoredRootHandle)
  storedHandle: null as
    | (FileSystemDirectoryHandle & { __perm?: string })
    | null,
  storedPerm: 'granted' as PermissionState,
  // FsaDriver.reconnect / connect behaviour
  reconnectThrows: false,
  connectThrows: false as boolean | Error | DOMException,
  // initTagIndex behaviour
  initThrows: false,
  // spies
  setActiveDriver: vi.fn(),
  initTagIndex: vi.fn(),
  saveRootHandle: vi.fn(),
  clearStoredRootHandle: vi.fn(),
  flushTagIndexBeacon: vi.fn(),
}))

function makeFsaDriver(name: string) {
  return { rootHandle: { name } }
}

vi.mock('./lib/http-driver.ts', () => ({
  HttpDriver: {
    detect: vi.fn(async () => mocks.httpDriver),
  },
}))

vi.mock('./lib/legacy-index-api.ts', () => ({
  fetchLegacyIndexStatus: vi.fn(async () => {
    if (mocks.legacyThrows) throw new Error('probe failed')
    return mocks.legacyStatus
  }),
}))

vi.mock('./lib/fsa-driver.ts', () => ({
  isFileSystemAccessSupported: () => mocks.fsaSupported,
  FsaDriver: {
    reconnect: vi.fn(async () => {
      if (mocks.reconnectThrows) throw new Error('reconnect failed')
      return makeFsaDriver('reconnected-folder')
    }),
    connect: vi.fn(async () => {
      if (mocks.connectThrows) throw mocks.connectThrows
      return makeFsaDriver('picked-folder')
    }),
  },
}))

vi.mock('./lib/handle-store.ts', () => ({
  loadStoredRootHandle: vi.fn(async () => mocks.storedHandle),
  saveRootHandle: (...a: unknown[]) => mocks.saveRootHandle(...a),
  clearStoredRootHandle: (...a: unknown[]) => mocks.clearStoredRootHandle(...a),
}))

vi.mock('./lib/storage-driver.ts', () => ({
  setActiveDriver: (...a: unknown[]) => mocks.setActiveDriver(...a),
}))

vi.mock('./lib/tags.ts', () => ({
  initTagIndex: async (...a: unknown[]) => {
    mocks.initTagIndex(...a)
    if (mocks.initThrows) throw new Error('tag index failed')
  },
  flushTagIndexBeacon: (...a: unknown[]) => {
    mocks.flushTagIndexBeacon(...a)
    return Promise.resolve()
  },
}))

// Stub heavy children to keep the render cheap and deterministic.
vi.mock('./components/AppShell.tsx', () => ({
  AppShell: ({ rootHandle }: { rootHandle: { name: string } }) => (
    <div data-testid="app-shell">{rootHandle.name}</div>
  ),
}))
vi.mock('./components/StarField.tsx', () => ({
  StarField: () => <div data-testid="star-field" />,
}))
vi.mock('./components/MigrationScreen.tsx', () => ({
  MigrationScreen: ({
    rootFolderName,
    onDone,
    onSkip,
  }: {
    rootFolderName: string
    onDone: () => void
    onSkip: () => void
  }) => (
    <div data-testid="migration-screen">
      <span>{rootFolderName}</span>
      <button type="button" onClick={onDone}>
        do-import
      </button>
      <button type="button" onClick={onSkip}>
        do-skip
      </button>
    </div>
  ),
}))

import { App } from './app.tsx'

// A stored handle stub whose queryPermission reflects mocks.storedPerm.
function makeStoredHandle(name: string): FileSystemDirectoryHandle {
  return {
    name,
    queryPermission: vi.fn(async () => mocks.storedPerm),
  } as unknown as FileSystemDirectoryHandle
}

beforeEach(() => {
  mocks.httpDriver = null
  mocks.legacyStatus = { available: false, entryCount: 0 }
  mocks.legacyThrows = false
  mocks.fsaSupported = false
  mocks.storedHandle = null
  mocks.storedPerm = 'granted'
  mocks.reconnectThrows = false
  mocks.connectThrows = false
  mocks.initThrows = false
  mocks.setActiveDriver.mockClear()
  mocks.initTagIndex.mockClear()
  mocks.saveRootHandle.mockClear()
  mocks.clearStoredRootHandle.mockClear()
  mocks.flushTagIndexBeacon.mockClear()
})

afterEach(async () => {
  cleanup()
  // Let any in-flight boot IIFE settle so its microtasks don't leak into the
  // next test (each test unmounts via cleanup, flipping `cancelled`, but the
  // pending promise still needs to drain).
  await new Promise((r) => setTimeout(r, 0))
})

describe('App boot phases', () => {
  it('shows the loading screen before detection resolves', () => {
    render(<App />)
    expect(screen.getByText('loading')).toBeTruthy()
    expect(screen.getByTestId('star-field')).toBeTruthy()
  })

  it('connects via HTTP when a server is reachable and no legacy index exists', async () => {
    mocks.httpDriver = makeFsaDriver('http-root')
    render(<App />)
    await waitFor(() => screen.getByTestId('app-shell'))
    expect(screen.getByText('http-root')).toBeTruthy()
    expect(mocks.setActiveDriver).toHaveBeenCalledTimes(1)
    expect(mocks.initTagIndex).toHaveBeenCalledTimes(1)
  })

  it('routes to migration when HTTP server has a legacy index, then imports', async () => {
    mocks.httpDriver = makeFsaDriver('http-root')
    mocks.legacyStatus = { available: true, entryCount: 5 }
    render(<App />)
    await waitFor(() => screen.getByTestId('migration-screen'))
    expect(screen.getByText('http-root')).toBeTruthy()
    // onDone -> connect
    fireEvent.click(screen.getByText('do-import'))
    await waitFor(() => screen.getByTestId('app-shell'))
  })

  it('routes to migration then connects on skip', async () => {
    mocks.httpDriver = makeFsaDriver('http-root')
    mocks.legacyStatus = { available: true, entryCount: 2 }
    render(<App />)
    await waitFor(() => screen.getByTestId('migration-screen'))
    fireEvent.click(screen.getByText('do-skip'))
    await waitFor(() => screen.getByTestId('app-shell'))
  })

  it('connects via HTTP when the legacy-status probe throws', async () => {
    mocks.httpDriver = makeFsaDriver('http-root')
    mocks.legacyThrows = true
    render(<App />)
    await waitFor(() => screen.getByTestId('app-shell'))
  })

  it('fails when no server and FSA is unsupported', async () => {
    mocks.httpDriver = null
    mocks.fsaSupported = false
    render(<App />)
    await waitFor(() =>
      screen.getByText(/does not support the File System Access API/i)
    )
  })

  it('falls through to needs-folder when no server, FSA supported, no stored handle', async () => {
    mocks.fsaSupported = true
    mocks.storedHandle = null
    render(<App />)
    await waitFor(() => screen.getByText('pick a folder'))
  })

  it('reuses a granted stored handle without prompting', async () => {
    mocks.fsaSupported = true
    mocks.storedHandle = makeStoredHandle('saved') as never
    mocks.storedPerm = 'granted'
    render(<App />)
    await waitFor(() => screen.getByTestId('app-shell'))
    expect(screen.getByText('reconnected-folder')).toBeTruthy()
  })

  it('drops the stored handle and asks for a folder when reconnect throws on granted', async () => {
    mocks.fsaSupported = true
    mocks.storedHandle = makeStoredHandle('saved') as never
    mocks.storedPerm = 'granted'
    mocks.reconnectThrows = true
    render(<App />)
    await waitFor(() => screen.getByText('pick a folder'))
    expect(mocks.clearStoredRootHandle).toHaveBeenCalled()
  })

  it('shows the reconnect screen when permission is prompt', async () => {
    mocks.fsaSupported = true
    mocks.storedHandle = makeStoredHandle('saved') as never
    mocks.storedPerm = 'prompt'
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'reconnect' }))
    expect(screen.getByText('saved')).toBeTruthy()
  })

  it('drops the stored handle when permission is denied and asks for a folder', async () => {
    mocks.fsaSupported = true
    mocks.storedHandle = makeStoredHandle('saved') as never
    mocks.storedPerm = 'denied'
    render(<App />)
    await waitFor(() => screen.getByText('pick a folder'))
    expect(mocks.clearStoredRootHandle).toHaveBeenCalled()
  })

  it('fails when initTagIndex throws during connect', async () => {
    mocks.httpDriver = makeFsaDriver('http-root')
    mocks.initThrows = true
    render(<App />)
    await waitFor(() => screen.getByText(/tag index failed/i))
  })
})

describe('App reconnect screen interactions', () => {
  beforeEach(() => {
    mocks.fsaSupported = true
    mocks.storedHandle = makeStoredHandle('saved') as never
    mocks.storedPerm = 'prompt'
  })

  it('reconnects on click and connects', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'reconnect' }))
    fireEvent.click(screen.getByRole('button', { name: 'reconnect' }))
    await waitFor(() => screen.getByTestId('app-shell'))
  })

  it('falls back to needs-folder when reconnect-click throws', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: 'reconnect' }))
    mocks.reconnectThrows = true
    fireEvent.click(screen.getByRole('button', { name: 'reconnect' }))
    await waitFor(() => screen.getByText('pick a folder'))
    expect(mocks.clearStoredRootHandle).toHaveBeenCalled()
  })

  it('forgets the folder and asks to pick a different one', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('pick different folder'))
    fireEvent.click(screen.getByText('pick different folder'))
    await waitFor(() => screen.getByText('pick a folder'))
    expect(mocks.clearStoredRootHandle).toHaveBeenCalled()
  })
})

describe('App pick-folder screen interactions', () => {
  beforeEach(() => {
    mocks.fsaSupported = true
    mocks.storedHandle = null
  })

  it('picks a folder, saves the handle, and connects', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('pick a folder'))
    fireEvent.click(screen.getByRole('button', { name: 'pick folder' }))
    await waitFor(() => screen.getByTestId('app-shell'))
    expect(mocks.saveRootHandle).toHaveBeenCalled()
  })

  it('stays on the screen when the picker is aborted', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('pick a folder'))
    mocks.connectThrows = new DOMException('aborted', 'AbortError')
    fireEvent.click(screen.getByRole('button', { name: 'pick folder' }))
    // Stays on pick-folder; no app-shell appears.
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByTestId('app-shell')).toBeNull()
    expect(screen.getByText('pick a folder')).toBeTruthy()
  })

  it('shows a failure screen for a non-abort picker error', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('pick a folder'))
    mocks.connectThrows = new Error('disk gone')
    fireEvent.click(screen.getByRole('button', { name: 'pick folder' }))
    await waitFor(() => screen.getByText(/disk gone/i))
  })
})

describe('App pagehide beacon', () => {
  it('flushes the tag index on pagehide', async () => {
    mocks.httpDriver = makeFsaDriver('http-root')
    render(<App />)
    await waitFor(() => screen.getByTestId('app-shell'))
    window.dispatchEvent(new Event('pagehide'))
    expect(mocks.flushTagIndexBeacon).toHaveBeenCalled()
  })
})

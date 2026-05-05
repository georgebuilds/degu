import { useEffect, useState } from 'preact/hooks'
import { AppShell } from './components/AppShell.tsx'
import { StarField } from './components/StarField.tsx'
import { FsaDriver, isFileSystemAccessSupported } from './lib/fsa-driver.ts'
import {
  clearStoredRootHandle,
  loadStoredRootHandle,
  saveRootHandle,
} from './lib/handle-store.ts'
import { HttpDriver } from './lib/http-driver.ts'
import {
  setActiveDriver,
  type StorageDriver,
} from './lib/storage-driver.ts'
import { flushTagIndex, initTagIndex } from './lib/tags.ts'

/**
 * Boot phases:
 *   - **detecting** — checking whether a Go server is reachable on /api/info,
 *     and whether a previously-picked FSA folder is still permission-granted.
 *   - **reconnect** — we have a stored FSA handle but it needs a click to
 *     re-request permission (browsers gate this behind a user gesture).
 *   - **needs-folder** — no Go server, no stored handle, need a fresh
 *     `showDirectoryPicker` from a user gesture.
 *   - **connected** — driver is active, tags are loaded, render AppShell.
 *   - **failed** — neither HTTP nor FSA is available; show the original
 *     "couldn't reach the server" guidance.
 */
type BootPhase =
  | { kind: 'detecting' }
  | { kind: 'reconnect'; handle: FileSystemDirectoryHandle }
  | { kind: 'needs-folder' }
  | { kind: 'connected'; driver: StorageDriver }
  | { kind: 'failed'; message: string }

export function App() {
  const [phase, setPhase] = useState<BootPhase>({ kind: 'detecting' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // 1) Try the local Go server. This wins whenever degu is running as a
      //    Wails app or via the headless CLI — both expose /api/info.
      const http = await HttpDriver.detect()
      if (cancelled) return
      if (http) {
        await connect(http, setPhase)
        return
      }

      // 2) No server. Try the FSA fallback.
      if (!isFileSystemAccessSupported()) {
        setPhase({
          kind: 'failed',
          message:
            'No degu server reachable, and this browser does not support the File System Access API.',
        })
        return
      }

      // 2a) If we previously picked a folder and the browser still grants
      //     permission, reuse it — no prompt.
      const stored = await loadStoredRootHandle()
      if (cancelled) return
      if (stored) {
        const perm = await stored.queryPermission({ mode: 'readwrite' })
        if (cancelled) return
        if (perm === 'granted') {
          try {
            const driver = await FsaDriver.reconnect(stored)
            if (cancelled) return
            await connect(driver, setPhase)
          } catch {
            await clearStoredRootHandle()
            if (!cancelled) setPhase({ kind: 'needs-folder' })
          }
          return
        }
        if (perm === 'prompt') {
          setPhase({ kind: 'reconnect', handle: stored })
          return
        }
        // 'denied' — drop the stored handle and fall through.
        await clearStoredRootHandle()
      }

      setPhase({ kind: 'needs-folder' })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onHide = () => {
      void flushTagIndex().catch(() => {})
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  if (phase.kind === 'detecting') {
    return (
      <>
        <StarField />
        <BootLoading />
      </>
    )
  }

  if (phase.kind === 'reconnect') {
    return (
      <>
        <StarField />
        <ReconnectFolder
          name={phase.handle.name}
          onClick={async () => {
            try {
              const driver = await FsaDriver.reconnect(phase.handle)
              await connect(driver, setPhase)
            } catch (err) {
              await clearStoredRootHandle()
              setPhase({ kind: 'needs-folder' })
              void err
            }
          }}
          onForget={async () => {
            await clearStoredRootHandle()
            setPhase({ kind: 'needs-folder' })
          }}
        />
      </>
    )
  }

  if (phase.kind === 'needs-folder') {
    return (
      <>
        <StarField />
        <PickFolder
          onPick={async () => {
            try {
              const driver = await FsaDriver.connect()
              await saveRootHandle(driver.rootHandle)
              await connect(driver, setPhase)
            } catch (err) {
              if (err instanceof DOMException && err.name === 'AbortError') {
                /* user cancelled the picker — stay on this screen */
                return
              }
              setPhase({
                kind: 'failed',
                message: err instanceof Error ? err.message : 'Could not open folder.',
              })
            }
          }}
        />
      </>
    )
  }

  if (phase.kind === 'failed') {
    return (
      <>
        <StarField />
        <BootError message={phase.message} />
      </>
    )
  }

  return <AppShell key="root" rootHandle={phase.driver.rootHandle} />
}

async function connect(
  driver: StorageDriver,
  setPhase: (p: BootPhase) => void
): Promise<void> {
  setActiveDriver(driver)
  try {
    await initTagIndex()
    setPhase({ kind: 'connected', driver })
  } catch (err) {
    setPhase({
      kind: 'failed',
      message: err instanceof Error ? err.message : 'Could not load tag index.',
    })
  }
}

function BootLoading() {
  return (
    <div class="relative z-10 flex min-h-[100svh] items-center justify-center">
      <div class="flex flex-col items-center gap-5 text-center font-mono">
        <span class="text-[11px] uppercase tracking-[0.28em] text-zinc-500">
          degu
        </span>
        <span
          class="saffron-pulse h-2 w-2 rounded-full bg-sky-500"
          aria-hidden="true"
        />
        <span class="text-xs uppercase tracking-[0.18em] text-zinc-400">
          loading
        </span>
      </div>
    </div>
  )
}

function ReconnectFolder({
  name,
  onClick,
  onForget,
}: {
  name: string
  onClick: () => void
  onForget: () => void
}) {
  return (
    <div class="relative z-10 flex min-h-[100svh] items-center justify-center px-6">
      <div class="flex max-w-md flex-col items-center gap-5 text-center">
        <span class="font-mono text-[11px] uppercase tracking-[0.28em] text-sky-500">
          degu · drop-on-drive mode
        </span>
        <h1 class="font-mono text-lg font-medium text-zinc-100">
          reconnect <span class="text-zinc-300">{name}</span>?
        </h1>
        <p class="font-mono text-xs leading-relaxed text-zinc-400">
          The browser revoked access on reload. Click to re-grant — your tags
          stay in <code>index.json</code> next to your media.
        </p>
        <div class="flex gap-3">
          <button
            type="button"
            class="rounded-md border border-sky-500 bg-sky-500/10 px-5 py-2 font-mono text-sm text-sky-300 hover:bg-sky-500/20"
            onClick={onClick}
          >
            reconnect
          </button>
          <button
            type="button"
            class="rounded-md border border-zinc-700 px-4 py-2 font-mono text-xs text-zinc-500 hover:text-zinc-300"
            onClick={onForget}
          >
            pick different folder
          </button>
        </div>
      </div>
    </div>
  )
}

function PickFolder({ onPick }: { onPick: () => void }) {
  return (
    <div class="relative z-10 flex min-h-[100svh] items-center justify-center px-6">
      <div class="flex max-w-md flex-col items-center gap-5 text-center">
        <span class="font-mono text-[11px] uppercase tracking-[0.28em] text-sky-500">
          degu · drop-on-drive mode
        </span>
        <h1 class="font-mono text-lg font-medium text-zinc-100">
          pick a folder
        </h1>
        <p class="font-mono text-xs leading-relaxed text-zinc-400">
          No local degu server is running, but your browser supports the File
          System Access API. Pick the folder you want to browse — your tags
          will be stored in <code>index.json</code> next to your media.
        </p>
        <button
          type="button"
          class="rounded-md border border-sky-500 bg-sky-500/10 px-5 py-2 font-mono text-sm text-sky-300 hover:bg-sky-500/20"
          onClick={onPick}
        >
          pick folder
        </button>
      </div>
    </div>
  )
}

function BootError({ message }: { message: string }) {
  return (
    <div class="relative z-10 flex min-h-[100svh] items-center justify-center px-6">
      <div class="flex max-w-xl flex-col gap-5 text-center">
        <span class="font-mono text-[11px] uppercase tracking-[0.28em] text-sky-500">
          degu · server unreachable
        </span>
        <h1 class="font-mono text-lg font-medium text-zinc-100">
          couldn’t talk to the local server
        </h1>
        <p class="font-mono text-xs leading-relaxed text-zinc-400">{message}</p>
        <div class="mx-auto w-full max-w-md overflow-hidden rounded-lg border border-zinc-700 bg-black/40 text-left backdrop-blur">
          <div class="flex items-center gap-1.5 border-b border-zinc-800/80 bg-black/30 px-3 py-2">
            <span class="h-2 w-2 rounded-full bg-zinc-700" />
            <span class="h-2 w-2 rounded-full bg-zinc-700" />
            <span class="h-2 w-2 rounded-full bg-zinc-700" />
            <span class="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              ~ run this
            </span>
          </div>
          <div class="px-4 py-3 font-mono text-xs">
            <span class="text-sky-500">$ </span>
            <span class="text-zinc-100">degu /path/to/folder</span>
          </div>
        </div>
        <p class="font-mono text-[11px] text-zinc-500">
          then reload this page.
        </p>
      </div>
    </div>
  )
}

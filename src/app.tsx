import { useEffect, useState } from 'preact/hooks'
import { AppShell } from './components/AppShell.tsx'
import { StarField } from './components/StarField.tsx'
import { getInfo } from './lib/api-client.ts'
import { HttpDirectoryHandle } from './lib/http-handles.ts'
import { flushTagIndex, initTagIndex } from './lib/tags.ts'

/**
 * The Go server already knows the media root (passed on the CLI), so the SPA
 * boots straight into the AppShell. There is no folder picker, no permission
 * dance, no IndexedDB-stored handle — the server fetches /api/info to learn
 * its own root name and seeds an HTTP-backed handle.
 *
 * The handle exposes the same surface (`values()`, `getFile()`,
 * `removeEntry()` …) the components used against the File System Access API,
 * so the rest of the tree didn't have to change shape in this commit.
 *
 * Loading + error states render directly on the body atmosphere (night sky
 * gradient + StarField) so the brief moment between window-paint and SPA-mount
 * — and any "couldn't reach the server" state — both land in the landing
 * page's vocabulary instead of a flat black.
 */
export function App() {
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(
    null
  )
  const [bootError, setBootError] = useState<string | null>(null)
  const [tagIndexReady, setTagIndexReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const info = await getInfo()
        if (cancelled) return
        const rootName =
          info.root.split('/').filter(Boolean).pop() ?? info.root ?? 'root'
        const handle = new HttpDirectoryHandle({ name: rootName, relativePath: '' })
        setRootHandle(handle as unknown as FileSystemDirectoryHandle)
      } catch (e) {
        if (!cancelled) {
          setBootError(e instanceof Error ? e.message : 'failed to reach degu server')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!rootHandle) {
      setTagIndexReady(false)
      return
    }
    setTagIndexReady(false)
    let cancelled = false
    void initTagIndex().finally(() => {
      if (!cancelled) setTagIndexReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [rootHandle])

  useEffect(() => {
    const onHide = () => {
      void flushTagIndex().catch(() => {})
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  if (bootError) {
    return (
      <>
        <StarField />
        <BootError message={bootError} />
      </>
    )
  }

  if (!rootHandle || !tagIndexReady) {
    return (
      <>
        <StarField />
        <BootLoading />
      </>
    )
  }

  return <AppShell key="root" rootHandle={rootHandle} />
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

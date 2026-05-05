import type { ComponentChildren } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  buildAggregateFromTagIndex,
  getDistinctTagsFromIndex,
  getTags,
  markReviewed,
  setTags,
} from '../lib/tags'
import { collectAllMediaRelativePaths } from '../lib/media-paths'
import { resolvePathToFileListItem } from '../lib/resolve-path'
import { getPreviewKind, type PreviewKind } from '../lib/preview'
import { useFileBlobURL } from '../lib/use-blob-url'
import { recordTagApplied } from '../lib/recent-tags'
import { useRecentTags } from '../lib/use-recent-tags'
import { useTagIndexVersion } from '../lib/use-tag-index-version'
import { tagColor } from '../lib/tag-color'
import { formatBytes } from '../lib/format-bytes'
import { Burroughs } from './Burroughs'

/** How many recent tags get a numeric hotkey (1–9). */
const HOTKEY_SLOTS = 9

type Item = {
  path: string
  tagCount: number
}

type ResolvedItem = {
  name: string
  handle: FileSystemFileHandle
  size: number
  lastModified: number
  kind: PreviewKind
}

type TriageScreenProps = {
  rootHandle: FileSystemDirectoryHandle
  rootFolderName: string
}

/**
 * One-file-at-a-time tag triage. Sorted by tag count ascending (untagged
 * first). Numeric keys 1–9 apply the corresponding recent tag, T focuses the
 * new-tag input, S marks reviewed without tagging, → / J advances.
 */
export function TriageScreen({ rootHandle, rootFolderName }: TriageScreenProps) {
  const [queue, setQueue] = useState<Item[] | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const tagIndexVersion = useTagIndexVersion()
  const queueRef = useRef<Item[] | null>(null)
  const cursorRef = useRef(0)
  queueRef.current = queue
  cursorRef.current = cursor

  useEffect(() => {
    let cancelled = false
    const isInitial = queueRef.current === null
    if (isInitial) {
      setQueue(null)
      setScanError(null)
    }
    void (async () => {
      try {
        const paths = await collectAllMediaRelativePaths(rootHandle)
        if (cancelled) return
        const items: Item[] = paths.map(p => ({
          path: p,
          tagCount: getTags(p).length,
        }))
        items.sort(
          (a, b) => a.tagCount - b.tagCount || a.path.localeCompare(b.path)
        )
        const prevQueue = queueRef.current
        const prevCursor = cursorRef.current
        const prevPath =
          prevQueue && prevCursor < prevQueue.length
            ? prevQueue[prevCursor]!.path
            : null
        setQueue(items)
        if (prevPath === null) {
          setCursor(0)
          return
        }
        const newIdx = items.findIndex(it => it.path === prevPath)
        if (newIdx !== -1) {
          setCursor(newIdx)
          return
        }
        // Current item is gone (e.g. became fully reviewed and filtered out);
        // try the next sibling from the previous queue, then clamp.
        for (let i = prevCursor + 1; i < prevQueue!.length; i++) {
          const nextPath = prevQueue![i]!.path
          const j = items.findIndex(it => it.path === nextPath)
          if (j !== -1) {
            setCursor(j)
            return
          }
        }
        setCursor(Math.min(prevCursor, items.length))
      } catch (e) {
        if (cancelled) return
        setScanError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rootHandle, tagIndexVersion])

  const advance = useCallback(() => {
    setCursor(c => c + 1)
  }, [])

  const goBack = useCallback(() => {
    setCursor(c => Math.max(0, c - 1))
  }, [])

  const current = queue && cursor < queue.length ? queue[cursor]! : null
  const isDone = queue !== null && cursor >= queue.length

  if (scanError !== null) {
    return (
      <div class="flex flex-1 items-center justify-center px-6 text-center">
        <div>
          <div class="text-sm text-rose-300">Could not read folder.</div>
          <div class="mt-1 font-mono text-xs text-zinc-500">{scanError}</div>
        </div>
      </div>
    )
  }

  if (queue === null) {
    return (
      <div class="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Reading folder…
      </div>
    )
  }

  if (queue.length === 0) {
    return (
      <DoneScreen
        title="Nothing here yet"
        body={
          <>
            No media files found under{' '}
            <span class="text-zinc-300">{rootFolderName}</span>.
          </>
        }
        rootFolderName={rootFolderName}
        totalFiles={0}
      />
    )
  }

  if (isDone || !current) {
    return (
      <DoneScreen
        title="All sorted."
        body={<>Burroughs has nothing left to do. Take a break.</>}
        rootFolderName={rootFolderName}
        totalFiles={queue.length}
      />
    )
  }

  return (
    <TriageItemView
      key={current.path}
      rootHandle={rootHandle}
      rootFolderName={rootFolderName}
      item={current}
      remaining={queue.length - cursor}
      onAdvance={advance}
      onBack={cursor > 0 ? goBack : null}
    />
  )
}

type TriageItemViewProps = {
  rootHandle: FileSystemDirectoryHandle
  rootFolderName: string
  item: Item
  remaining: number
  onAdvance: () => void
  onBack: (() => void) | null
}

function TriageItemView({
  rootHandle,
  rootFolderName,
  item,
  remaining,
  onAdvance,
  onBack,
}: TriageItemViewProps) {
  const [resolved, setResolved] = useState<ResolvedItem | null>(null)
  const [resolveError, setResolveError] = useState(false)
  const [tags, setLocalTags] = useState<string[]>(() => getTags(item.path))
  const [newTagDraft, setNewTagDraft] = useState('')
  const newTagInputRef = useRef<HTMLInputElement | null>(null)
  const recent = useRecentTags()
  const tagIndexVersion = useTagIndexVersion()

  /** Resolve handle for the current path. */
  useEffect(() => {
    let cancelled = false
    setResolved(null)
    setResolveError(false)
    setLocalTags(getTags(item.path))
    void (async () => {
      try {
        const fli = await resolvePathToFileListItem(rootHandle, item.path)
        if (cancelled) return
        const kind = getPreviewKind(fli.name)
        if (!kind) {
          setResolveError(true)
          return
        }
        setResolved({
          name: fli.name,
          handle: fli.handle,
          size: fli.size,
          lastModified: fli.lastModified,
          kind,
        })
      } catch {
        if (!cancelled) setResolveError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [item.path, rootHandle])

  const knownTags = useMemo(() => getDistinctTagsFromIndex(), [tagIndexVersion])
  const currentTagSet = useMemo(() => new Set(tags), [tags])

  /**
   * Hotkey tags: recent tags that aren't already on this file. We pull from
   * the user's MRU list first; if there aren't enough, fall back to the most
   * common existing tags so the slots stay populated for new users.
   */
  const hotkeyTags = useMemo(() => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const t of recent) {
      if (out.length >= HOTKEY_SLOTS) break
      if (!seen.has(t) && !currentTagSet.has(t)) {
        out.push(t)
        seen.add(t)
      }
    }
    if (out.length < HOTKEY_SLOTS) {
      const counts = buildAggregateFromTagIndex().counts
      const sortedByPopularity = [...counts].sort((a, b) => b.count - a.count)
      for (const { tag } of sortedByPopularity) {
        if (out.length >= HOTKEY_SLOTS) break
        if (!seen.has(tag) && !currentTagSet.has(tag)) {
          out.push(tag)
          seen.add(tag)
        }
      }
    }
    return out
  }, [recent, currentTagSet, tagIndexVersion])

  const applyTag = useCallback(
    (raw: string) => {
      const tag = raw.trim()
      if (!tag) return
      if (currentTagSet.has(tag)) return
      const next = [...tags, tag]
      setTags(item.path, next)
      recordTagApplied(tag)
      setLocalTags(next)
    },
    [currentTagSet, item.path, tags]
  )

  const removeTag = useCallback(
    (tag: string) => {
      const next = tags.filter(t => t !== tag)
      setTags(item.path, next)
      setLocalTags(next)
    },
    [item.path, tags]
  )

  const skip = useCallback(() => {
    markReviewed(item.path)
    onAdvance()
  }, [item.path, onAdvance])

  const commitNewTag = useCallback(() => {
    const v = newTagDraft.trim()
    if (!v) return
    applyTag(v)
    setNewTagDraft('')
  }, [applyTag, newTagDraft])

  /** Global keyboard handlers: 1–9 hotkey, T new, S skip, →/J next, ←/K prev. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true
      if (inField) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1
        const t = hotkeyTags[idx]
        if (t) {
          e.preventDefault()
          applyTag(t)
        }
        return
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        newTagInputRef.current?.focus()
        return
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        skip()
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'J') {
        e.preventDefault()
        onAdvance()
        return
      }
      if (
        (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'K') &&
        onBack
      ) {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [applyTag, hotkeyTags, onAdvance, onBack, skip])

  const breadcrumb = useMemo(() => {
    const parts = item.path.split('/').filter(Boolean)
    return parts.slice(0, -1).join(' / ')
  }, [item.path])

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-10 py-8">
      <header class="mb-7 flex items-center justify-between gap-4">
        <div class="font-mono text-xs text-zinc-400">
          <span class="text-zinc-500">{rootFolderName}</span>
          {breadcrumb ? (
            <>
              <span class="text-zinc-600"> / </span>
              <span class="text-zinc-300">{breadcrumb}</span>
            </>
          ) : null}
        </div>
        <span class="inline-flex items-center gap-2 rounded-full bg-sky-900 px-3 py-1.5 font-mono text-xs font-medium text-sky-400">
          <span class="h-1.5 w-1.5 rounded-full bg-sky-500" />
          {remaining} to triage
        </span>
      </header>

      <div class="grid flex-1 grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div class="flex min-w-0 flex-col">
          <h1 class="text-5xl font-semibold leading-none tracking-tight text-zinc-100">
            {tags.length === 0 ? (
              <>untagged</>
            ) : (
              <>
                {tags.length}{' '}
                <span class="text-zinc-500">{tags.length === 1 ? 'tag' : 'tags'}</span>
              </>
            )}
          </h1>
          <p class="mt-2 text-sm text-zinc-400">
            {tags.length === 0
              ? 'Tap a number to apply a tag, T for a new one, S to skip.'
              : 'Already tagged — but you can add more or skip.'}
          </p>

          <div class="mt-6 overflow-hidden rounded-xl bg-zinc-800">
            {resolved ? (
              <TriageMedia handle={resolved.handle} kind={resolved.kind} alt={resolved.name} />
            ) : resolveError ? (
              <div class="flex aspect-[4/3] items-center justify-center text-sm text-zinc-500">
                Could not open this file.
              </div>
            ) : (
              <div class="aspect-[4/3] animate-pulse bg-zinc-800" />
            )}
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-3 font-mono text-xs text-zinc-400">
            <b class="font-medium text-zinc-100">{resolved?.name ?? item.path.split('/').pop()}</b>
            {resolved ? (
              <>
                <span class="h-1 w-1 rounded-full bg-zinc-500" />
                <span>{formatBytes(resolved.size)}</span>
                <span class="h-1 w-1 rounded-full bg-zinc-500" />
                <span>{new Date(resolved.lastModified).toLocaleString()}</span>
              </>
            ) : null}
          </div>

          {tags.length > 0 ? (
            <div class="mt-5">
              <div class="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Current tags
              </div>
              <div class="flex flex-wrap gap-1.5">
                {tags.map(t => (
                  <button
                    key={t}
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:border-zinc-500"
                    onClick={() => removeTag(t)}
                    title="Click to remove"
                  >
                    <span
                      class="h-1.5 w-1.5 rounded-full"
                      style={{ background: tagColor(t) }}
                    />
                    {t}
                    <span class="text-zinc-500">×</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <aside class="flex flex-col">
          <div class="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Recent tags  ·  press 1–9
          </div>
          {hotkeyTags.length === 0 ? (
            <p class="text-xs text-zinc-500">
              No tags yet. Press <kbd class="rounded bg-zinc-800 px-1 font-mono text-[10px]">T</kbd> to create your first.
            </p>
          ) : (
            <div class="flex flex-col gap-1.5">
              {hotkeyTags.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  class="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-700"
                  aria-keyshortcuts={String(i + 1)}
                  onClick={() => applyTag(t)}
                >
                  <span class="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-zinc-700 font-mono text-[10px] text-zinc-400">
                    {i + 1}
                  </span>
                  <span
                    class="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: tagColor(t) }}
                  />
                  <span class="flex-1 truncate">{t}</span>
                </button>
              ))}
            </div>
          )}

          <div class="mt-4 border-t border-zinc-800 pt-4">
            <div class="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              New tag  ·  press T
            </div>
            <div class="flex gap-2">
              <input
                ref={newTagInputRef}
                type="text"
                class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                placeholder="Type a tag…"
                value={newTagDraft}
                list="triage-tag-suggestions"
                autoComplete="off"
                aria-keyshortcuts="t"
                onInput={e =>
                  setNewTagDraft((e.target as HTMLInputElement).value)
                }
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitNewTag()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setNewTagDraft('')
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
              />
              <datalist id="triage-tag-suggestions">
                {knownTags.map(t => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <button
                type="button"
                disabled={!newTagDraft.trim()}
                class="rounded-md bg-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={commitNewTag}
              >
                Add
              </button>
            </div>
          </div>

          <div class="mt-5 flex gap-2 border-t border-zinc-800 pt-4">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-700"
              disabled={!onBack}
              onClick={() => onBack?.()}
              title="Previous"
              aria-keyshortcuts="ArrowLeft"
            >
              <span class="rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                ←
              </span>
              back
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-700"
              onClick={skip}
              aria-keyshortcuts="s"
            >
              <span class="rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                S
              </span>
              skip
            </button>
            <button
              type="button"
              class="ml-auto inline-flex items-center gap-2 rounded-md bg-sky-500 px-3 py-2 text-xs font-medium text-zinc-950 hover:brightness-110"
              onClick={onAdvance}
              aria-keyshortcuts="ArrowRight"
            >
              next
              <span class="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">
                →
              </span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}

function TriageMedia({
  handle,
  kind,
  alt,
}: {
  handle: FileSystemFileHandle
  kind: PreviewKind
  alt: string
}) {
  const { url } = useFileBlobURL(handle)
  if (!url) {
    return <div class="aspect-video animate-pulse bg-zinc-800" />
  }
  if (kind === 'video') {
    /**
     * Mirrors the working <video> setup in PreviewModal: autoplay+muted lets
     * Chromium start playback without a gesture, playsInline keeps iOS in-page,
     * and explicit play() on loadeddata covers blob-URL stalls observed in
     * recent Chromium when preload="metadata" was set.
     */
    return (
      <video
        src={url}
        controls
        autoPlay
        muted
        playsInline
        aria-label={alt}
        class="mx-auto block max-h-[60vh] w-full bg-black object-contain"
        onLoadedData={e => {
          void e.currentTarget.play().catch(() => {
            /* user can press the play control manually */
          })
        }}
      />
    )
  }
  return (
    <img
      src={url}
      alt={alt}
      class="mx-auto block max-h-[60vh] w-full bg-black object-contain"
    />
  )
}

type DoneScreenProps = {
  title: string
  body: ComponentChildren
  rootFolderName: string
  totalFiles: number
}

function DoneScreen({ title, body, rootFolderName, totalFiles }: DoneScreenProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <Burroughs size={160} />
      <h2 class="mt-6 text-3xl font-semibold tracking-tight text-zinc-100">
        {title}
      </h2>
      <p class="mt-2 max-w-sm text-sm text-zinc-400">{body}</p>
      <div class="mt-7 font-mono text-xs text-zinc-500">
        {rootFolderName}  ·  {totalFiles.toLocaleString()} files
      </div>
    </div>
  )
}


import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { PreviewKind } from '../lib/preview'
import { useFileBlobURL } from '../lib/use-blob-url'
import { useVideoABLoop } from '../lib/video-ab-loop.ts'

export type ViewerPaneItem = {
  /** Stable id (path-based tag key matches FileListItem, or `path#loop:uuid` for saved loops). */
  id: string
  name: string
  handle: FileSystemFileHandle
  kind: PreviewKind
  /** Video only: play and loop between these times (seconds). */
  loopRange?: { startSec: number; endSec: number }
}

const MIN_WIDTH_FOR_COLUMNS_PX = 300
const MIN_COLUMNS = 1
const MAX_COLUMNS = 6

const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
}

type ViewerMediaCellProps = {
  item: ViewerPaneItem
  onRemove: () => void
}

function ViewerMediaCell({ item, onRemove }: ViewerMediaCellProps) {
  const { url } = useFileBlobURL(item.handle)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useVideoABLoop(
    videoRef,
    item.kind === 'video' && item.loopRange
      ? {
          startSec: item.loopRange.startSec,
          endSec: item.loopRange.endSec,
        }
      : null
  )

  return (
    <div
      class="group relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-md border border-zinc-800/80 bg-zinc-950"
      title={item.name}
    >
      <button
        type="button"
        class="absolute right-0.5 top-0.5 z-10 rounded bg-zinc-950/90 px-1 py-0 text-[9px] leading-none text-zinc-400 opacity-0 shadow-sm hover:bg-zinc-800 hover:text-zinc-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-sky-500"
        onClick={onRemove}
        aria-label={`Remove ${item.name} from viewer`}
      >
        ✕
      </button>
      <div class="flex min-h-0 flex-1 items-center justify-center">
        {!url ? (
          <span class="py-2 text-[10px] text-zinc-600">…</span>
        ) : item.kind === 'image' ? (
          <img
            src={url}
            alt=""
            class="block h-full w-full object-contain"
          />
        ) : (
          <video
            ref={videoRef}
            src={url}
            class="block h-full w-full object-contain"
            aria-label={item.name}
            autoPlay
            muted
            controls
            loop={!item.loopRange}
            playsInline
          />
        )}
      </div>
    </div>
  )
}

type ViewerPaneProps = {
  items: ViewerPaneItem[]
  onRemove: (id: string) => void
  onClear: () => void
}

export function ViewerPane({ items, onRemove, onClear }: ViewerPaneProps) {
  const [expanded, setExpanded] = useState(false)
  const [columnCount, setColumnCount] = useState(2)
  const shellRef = useRef<HTMLDivElement>(null)
  const [shellWidth, setShellWidth] = useState(0)

  const measure = useCallback(() => {
    const el = shellRef.current
    if (el) setShellWidth(el.clientWidth)
  }, [])

  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, expanded, items.length])

  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const canMultiColumn = shellWidth > MIN_WIDTH_FOR_COLUMNS_PX
  const effectiveCols = canMultiColumn
    ? Math.min(Math.max(columnCount, MIN_COLUMNS), MAX_COLUMNS)
    : 1
  const gridClass = GRID_COLS[effectiveCols] ?? 'grid-cols-1'

  const bumpColumns = useCallback((delta: number) => {
    setColumnCount(c =>
      Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, c + delta))
    )
  }, [])

  if (items.length === 0) return null

  return (
    <aside
      ref={shellRef}
      class={
        expanded
          ? 'fixed inset-0 z-40 flex max-h-[100svh] min-h-0 w-screen max-w-[100vw] flex-col bg-zinc-950 shadow-2xl'
          : 'flex h-full max-h-[100svh] min-h-0 w-[min(100vw,20rem)] shrink-0 flex-col overflow-hidden border-l border-zinc-800 bg-zinc-950'
      }
      aria-label="Viewer pane"
    >
      <div class="flex flex-wrap items-center justify-between gap-1.5 border-b border-zinc-800/80 px-2 py-1">
        <h2 class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Viewer
          <span class="ml-0.5 font-normal text-zinc-600">({items.length})</span>
        </h2>
        <div class="flex flex-wrap items-center gap-0.5">
          {canMultiColumn ? (
            <div
              class="flex items-center gap-px rounded border border-zinc-800 bg-zinc-900/60 px-0.5 py-px"
              title="Grid columns (when pane is wider than 300px)"
            >
              <span class="hidden px-0.5 text-[9px] text-zinc-600 sm:inline">
                Cols
              </span>
              <button
                type="button"
                class="rounded px-1 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
                onClick={() => bumpColumns(-1)}
                disabled={columnCount <= MIN_COLUMNS}
                aria-label="Fewer columns"
              >
                −
              </button>
              <span class="min-w-[1rem] text-center text-[10px] tabular-nums text-zinc-500">
                {effectiveCols}
              </span>
              <button
                type="button"
                class="rounded px-1 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
                onClick={() => bumpColumns(1)}
                disabled={columnCount >= MAX_COLUMNS}
                aria-label="More columns"
              >
                +
              </button>
            </div>
          ) : null}
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-[10px] text-sky-500/90 hover:bg-zinc-800 hover:text-sky-300"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? 'Dock' : 'Fill'}
          </button>
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
      <div
        class={`grid min-h-0 flex-1 auto-rows-[minmax(0,1fr)] gap-1 overflow-y-auto px-1.5 py-1 [scrollbar-gutter:stable] ${gridClass}`}
      >
        {items.map(item => (
          <ViewerMediaCell
            key={item.id}
            item={item}
            onRemove={() => onRemove(item.id)}
          />
        ))}
      </div>
      {expanded ? (
        <p class="shrink-0 border-t border-zinc-800/80 px-2 py-0.5 text-center text-[9px] text-zinc-600">
          Esc or Dock to exit
        </p>
      ) : null}
    </aside>
  )
}

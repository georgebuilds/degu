import { memo } from 'preact/compat'
import { formatBytes } from '../lib/format-bytes.ts'
import type { PreviewKind } from '../lib/preview'

export type FileListItem = {
  kind: 'file'
  name: string
  /** Path relative to the connected root; unique key for tag storage. */
  tagStorageKey: string
  /** Path from current search folder, or from root when global; for display. */
  relativePath?: string
  handle: FileSystemFileHandle
  size: number
  lastModified: number
}

export type DirListItem = {
  kind: 'directory'
  name: string
  relativePath?: string
  handle: FileSystemDirectoryHandle
}

type FileRowProps = {
  item: FileListItem | DirListItem
  previewKind: PreviewKind | null
  onOpenDir: (name: string, handle: FileSystemDirectoryHandle) => void
  onPreview: (item: FileListItem, kind: PreviewKind) => void
  /** File rows: tags shown read-only; edit via context menu. */
  tags?: string[]
  onFileContextMenu?: (e: MouseEvent, item: FileListItem) => void
  /** List view: single-click selects, double-click opens preview. */
  selected?: boolean
  onFileSelect?: (e: MouseEvent, item: FileListItem) => void
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return '—'
  }
}

export const FileRow = memo(function FileRow({
  item,
  previewKind,
  onOpenDir,
  onPreview,
  tags = [],
  onFileContextMenu,
  selected = false,
  onFileSelect,
}: FileRowProps) {
  if (item.kind === 'directory') {
    return (
      <div class="flex flex-col gap-2 rounded-lg border border-zinc-700/80 bg-zinc-900/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0 flex-1">
          <button
            type="button"
            class="text-left font-medium text-sky-400 hover:text-sky-300 hover:underline"
            onClick={() => onOpenDir(item.name, item.handle)}
          >
            📁 {item.name}
          </button>
          {item.relativePath ? (
            <div
              class="mt-0.5 truncate text-xs text-zinc-500"
              title={item.relativePath}
            >
              {item.relativePath}
            </div>
          ) : null}
        </div>
        <span class="text-xs text-zinc-500">Folder</span>
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={item.name}
      class={
        selected
          ? 'flex flex-col gap-2 rounded-lg border-2 border-sky-500 bg-zinc-900/50 px-3 py-2 ring-1 ring-sky-500/30'
          : 'flex flex-col gap-2 rounded-lg border border-zinc-700/80 bg-zinc-900/40 px-3 py-2'
      }
      onClick={e => {
        if (e.button !== 0) return
        if (e.detail === 2) return
        onFileSelect?.(e, item as FileListItem)
      }}
      onDblClick={e => {
        if (e.button !== 0) return
        e.preventDefault()
        const pk = previewKind
        const fi = item as FileListItem
        if (pk) onPreview(fi, pk)
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const pk = previewKind
          const fi = item as FileListItem
          if (pk) onPreview(fi, pk)
        } else if (e.key === ' ') {
          e.preventDefault()
          const synthetic = {
            ...e,
            button: 0,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
          } as unknown as MouseEvent
          onFileSelect?.(synthetic, item as FileListItem)
        }
      }}
      onContextMenu={e => {
        e.preventDefault()
        onFileContextMenu?.(e, item as FileListItem)
      }}
    >
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium text-zinc-100" title={item.name}>
            {item.name}
          </div>
          {item.relativePath ? (
            <div
              class="truncate text-xs text-zinc-500"
              title={item.relativePath}
            >
              {item.relativePath}
            </div>
          ) : null}
          <div class="mt-0.5 text-xs text-zinc-500">
            {formatBytes(item.size)} · {formatDate(item.lastModified)}
          </div>
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-2">
          {previewKind ? (
            <button
              type="button"
              class="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500"
              onClick={e => {
                e.stopPropagation()
                onPreview(item, previewKind)
              }}
            >
              Preview
            </button>
          ) : null}
        </div>
      </div>
      {tags.length > 0 ? (
        <div class="flex flex-wrap gap-1.5">
          {tags.map(tag => (
            <span
              key={tag}
              class="rounded-full border border-zinc-700/80 bg-zinc-800/60 px-2 py-0.5 text-xs text-zinc-400"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
})

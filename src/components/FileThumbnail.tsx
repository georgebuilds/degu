import { memo } from 'preact/compat'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { PreviewKind } from '../lib/preview'
import type { DirListItem, FileListItem } from './FileRow.tsx'

type FileThumbnailProps = {
  item: FileListItem
  tags: string[]
  previewKind: PreviewKind | null
  selected: boolean
  onSelect: (e: MouseEvent, item: FileListItem) => void
  onPreview: (item: FileListItem, kind: PreviewKind) => void
  onContextMenu: (e: MouseEvent, item: FileListItem) => void
}

export const FileThumbnail = memo(function FileThumbnail({
  item,
  tags,
  previewKind,
  selected,
  onSelect,
  onPreview,
  onContextMenu,
}: FileThumbnailProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const urlRef = useRef<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (previewKind !== 'image') return
    if (visible) return
    const el = cardRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const obs = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            obs.disconnect()
            break
          }
        }
      },
      { rootMargin: '200px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [previewKind, visible])

  useEffect(() => {
    if (previewKind !== 'image') {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
      setThumbUrl(null)
      return
    }
    if (!visible) return
    if (urlRef.current) return
    let cancelled = false
    void (async () => {
      const file = await item.handle.getFile()
      if (cancelled) return
      let blobOrFile: Blob
      try {
        const bmp = await createImageBitmap(file, {
          resizeWidth: 320,
          resizeQuality: 'low',
        })
        if (cancelled) { bmp.close(); return }
        const canvas = new OffscreenCanvas(bmp.width, bmp.height)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bmp, 0, 0)
        bmp.close()
        blobOrFile = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
        if (cancelled) return
      } catch {
        if (cancelled) return
        blobOrFile = file
      }
      if (cancelled) return
      const u = URL.createObjectURL(blobOrFile)
      if (cancelled) { URL.revokeObjectURL(u); return }
      const prev = urlRef.current
      urlRef.current = u
      if (prev) URL.revokeObjectURL(prev)
      setThumbUrl(u)
    })()
    return () => {
      cancelled = true
    }
  }, [item.handle, previewKind, visible])

  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [])

  const onPreviewClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      if (previewKind) onPreview(item, previewKind)
    },
    [item, onPreview, previewKind]
  )

  const onCardClick = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 0) return
      if (e.detail === 2) return
      onSelect(e, item)
    },
    [item, onSelect]
  )

  const onCardDoubleClick = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      if (previewKind) onPreview(item, previewKind)
    },
    [item, onPreview, previewKind]
  )

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-label={item.name}
      aria-pressed={selected}
      class={
        selected
          ? 'group flex cursor-pointer flex-col overflow-hidden rounded-xl border-2 border-sky-500 bg-zinc-900/70 ring-1 ring-sky-500/40 transition hover:border-sky-400'
          : 'group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900/50 transition hover:border-zinc-500 hover:bg-zinc-900'
      }
      onClick={onCardClick}
      onDblClick={onCardDoubleClick}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (previewKind) onPreview(item, previewKind)
        } else if (e.key === ' ') {
          e.preventDefault()
          // Reuse the same selection semantics as a primary-button click.
          const synthetic = {
            ...e,
            button: 0,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
          } as unknown as MouseEvent
          onSelect(synthetic, item)
        }
      }}
      onContextMenu={e => {
        e.preventDefault()
        onContextMenu(e, item)
      }}
    >
      <div class="relative aspect-square bg-zinc-950/80">
        {selected ? (
          <span
            class="absolute left-2 top-2 z-10 grid h-5 w-5 place-items-center rounded-full bg-sky-500 text-[11px] font-bold text-white shadow"
            aria-hidden
          >
            ✓
          </span>
        ) : null}
        {previewKind === 'image' && thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.name}
            class="h-full w-full object-cover"
            loading="lazy"
          />
        ) : previewKind === 'video' ? (
          <div class="flex h-full w-full flex-col items-center justify-center gap-1 text-zinc-500">
            <span class="text-3xl" aria-hidden>
              ▶
            </span>
            <span class="text-[10px] uppercase tracking-wide">Video</span>
          </div>
        ) : (
          <div class="flex h-full w-full flex-col items-center justify-center gap-1 text-zinc-500">
            <span class="text-3xl" aria-hidden>
              📄
            </span>
            <span class="text-[10px] uppercase tracking-wide">File</span>
          </div>
        )}
        {previewKind ? (
          <button
            type="button"
            class="absolute bottom-2 right-2 rounded-md bg-sky-600/90 px-2 py-1 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100"
            onClick={onPreviewClick}
          >
            Preview
          </button>
        ) : null}
      </div>
      <div class="min-w-0 p-2">
        <div
          class="truncate text-center text-xs font-medium text-zinc-200"
          title={item.relativePath ?? item.name}
        >
          {item.name}
        </div>
        {item.relativePath ? (
          <div
            class="truncate text-center text-[10px] text-zinc-600"
            title={item.relativePath}
          >
            {item.relativePath}
          </div>
        ) : null}
        {tags.length > 0 ? (
          <div class="mt-1.5 flex flex-wrap justify-center gap-0.5">
            {tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                class="max-w-full truncate rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-400"
                title={tag}
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 ? (
              <span class="text-[9px] text-zinc-600">+{tags.length - 3}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
})

type FolderThumbnailProps = {
  item: DirListItem
  onOpen: (name: string, handle: FileSystemDirectoryHandle) => void
}

export const FolderThumbnail = memo(function FolderThumbnail({ item, onOpen }: FolderThumbnailProps) {
  return (
    <button
      type="button"
      class="flex flex-col overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900/50 text-left transition hover:border-sky-500/50 hover:bg-zinc-900"
      onClick={() => onOpen(item.name, item.handle)}
    >
      <div class="flex aspect-square items-center justify-center bg-zinc-950/80 text-5xl text-sky-400/90">
        📁
      </div>
      <div class="min-w-0 p-2">
        <div
          class="truncate text-center text-xs font-medium text-sky-300"
          title={item.relativePath ?? item.name}
        >
          {item.name}
        </div>
        {item.relativePath ? (
          <div
            class="truncate text-center text-[10px] text-zinc-600"
            title={item.relativePath}
          >
            {item.relativePath}
          </div>
        ) : null}
      </div>
    </button>
  )
})

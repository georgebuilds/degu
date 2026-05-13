import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { PreviewKind } from '../lib/preview'
import { QUICK_ADD_RECENT_VISIBLE } from '../lib/recent-tags.ts'
import {
  getVideoLoops,
  setVideoLoops,
  type VideoLoop,
} from '../lib/tags.ts'
import { trimVideoStreamCopy, terminateFFmpeg } from '../lib/ffmpeg-trim.ts'
import { MAX_TRIM_INPUT_BYTES } from '../lib/video-trim-scope.ts'
import { estimateTrimSavingsBytes } from '../lib/video-trim-estimate.ts'
import {
  saveTrimmedVideoBlob,
  trimmedFilenameSuggestion,
  type TrimSaveLocation,
} from '../lib/save-trimmed-video.ts'
import { formatMediaTime } from '../lib/format-media-time.ts'
import {
  useVideoABLoop,
  VIDEO_AB_LOOP_EPS,
} from '../lib/video-ab-loop.ts'
import { formatBytes } from '../lib/format-bytes.ts'
import { buildMoreQuickAddTagsSingle } from '../lib/more-quick-add-tags.ts'
import { MoreTagsQuickAddDropdown } from './MoreTagsQuickAddDropdown'
import { NewTagQuickAddDialog } from './NewTagQuickAddDialog.tsx'
import { useRecentTags } from '../lib/use-recent-tags.ts'
import { useFocusTrap } from '../lib/use-focus-trap.ts'
import { useFileBlobURL } from '../lib/use-blob-url.ts'
import { useModalEscape } from './use-modal-stack.ts'

type PreviewModalProps = {
  fileHandle: FileSystemFileHandle
  kind: PreviewKind
  /** Path relative to root; used for tags and video loop persistence. */
  tagStorageKey: string
  tags: string[]
  onApplyFrequentTag: (tag: string) => void
  onClose: () => void
  /** Remove the file from disk (after confirmation in the parent). */
  onDelete?: () => void | Promise<void>
  /** Open the scrub-metadata modal targeting just this file. */
  onScrubMetadata?: () => void
  fileSizeBytes: number
  fileName: string
  saveDirectoryHandle: FileSystemDirectoryHandle | null
  onTrimExported?: () => void
  /** Previous / next file in the current directory list (ArrowLeft / ArrowRight). */
  onNavigateSibling?: (delta: -1 | 1) => void
  /** Add this file’s saved loop to the right-hand Viewer pane. */
  onAddLoopToViewer?: (loop: VideoLoop) => void
  /** All tag names under the connected root (sidebar order); used for “More” quick-add. */
  allKnownTagNames?: readonly string[]
}

function keyboardTargetIsEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function PreviewModal({
  fileHandle,
  kind,
  tagStorageKey,
  tags,
  onApplyFrequentTag,
  onClose,
  onDelete,
  onScrubMetadata,
  fileSizeBytes,
  fileName,
  saveDirectoryHandle,
  onTrimExported,
  onNavigateSibling,
  onAddLoopToViewer,
  allKnownTagNames = [],
}: PreviewModalProps) {
  const { url } = useFileBlobURL(fileHandle)
  const dialogRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [duration, setDuration] = useState(0)
  const [loops, setLoops] = useState<VideoLoop[]>([])
  const [activeLoopId, setActiveLoopId] = useState<string | null>(null)
  const [draftStart, setDraftStart] = useState<number | null>(null)
  const [draftEnd, setDraftEnd] = useState<number | null>(null)

  const [exportingLoopId, setExportingLoopId] = useState<string | null>(null)
  const [trimProgress, setTrimProgress] = useState(0)
  const [trimError, setTrimError] = useState<string | null>(null)
  const [trimReport, setTrimReport] = useState<{
    originalBytes: number
    outputBytes: number
    saveLocation: TrimSaveLocation
  } | null>(null)
  const trimAbortRef = useRef<AbortController | null>(null)
  const trimBusyRef = useRef(false)
  const trimEverStartedRef = useRef(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [loopTimeDraftById, setLoopTimeDraftById] = useState<
    Record<string, { start: string; end: string }>
  >({})
  const [newTagDialogOpen, setNewTagDialogOpen] = useState(false)
  const newTagTriggerRef = useRef<HTMLButtonElement | null>(null)

  useFocusTrap(dialogRef, true)

  const recentTagsFull = useRecentTags()
  const recentTagsStrip = recentTagsFull.slice(0, QUICK_ADD_RECENT_VISIBLE)
  const moreTags = buildMoreQuickAddTagsSingle(
    allKnownTagNames,
    recentTagsFull,
    tags,
    QUICK_ADD_RECENT_VISIBLE
  )

  useEffect(() => {
    if (kind !== 'video') {
      setLoops([])
      setActiveLoopId(null)
      setDraftStart(null)
      setDraftEnd(null)
      setTrimReport(null)
      setTrimError(null)
      return
    }
    setLoops(getVideoLoops(tagStorageKey))
    setActiveLoopId(null)
    setDraftStart(null)
    setDraftEnd(null)
    setTrimReport(null)
    setTrimError(null)
  }, [kind, tagStorageKey, fileHandle])

  const persistLoops = useCallback(
    (next: VideoLoop[]) => {
      setVideoLoops(tagStorageKey, next)
      setLoops(next)
    },
    [tagStorageKey]
  )

  const activeLoop = activeLoopId
    ? loops.find(l => l.id === activeLoopId) ?? null
    : null

  useVideoABLoop(
    videoRef,
    kind === 'video' && activeLoop
      ? { startSec: activeLoop.startSec, endSec: activeLoop.endSec }
      : null
  )

  useEffect(() => {
    setLoopTimeDraftById(prev => {
      const ids = new Set(loops.map(l => l.id))
      let changed = false
      const next: Record<string, { start: string; end: string }> = {}
      for (const id in prev) {
        if (ids.has(id)) {
          next[id] = prev[id]!
        } else {
          changed = true
        }
      }
      for (const l of loops) {
        if (!(l.id in next)) {
          next[l.id] = {
            start: String(l.startSec),
            end: String(l.endSec),
          }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [loops])

  const markDraftStart = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    setDraftStart(el.currentTime)
  }, [])

  const markDraftEnd = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    setDraftEnd(el.currentTime)
  }, [])

  const saveDraftLoop = useCallback(() => {
    if (draftStart === null || draftEnd === null) return
    let a = draftStart
    let b = draftEnd
    if (a > b) [a, b] = [b, a]
    if (b - a < VIDEO_AB_LOOP_EPS) return
    const d = duration
    if (Number.isFinite(d) && d > 0) {
      a = Math.max(0, a)
      b = Math.min(b, d)
    }
    if (b - a < VIDEO_AB_LOOP_EPS) return
    const id = crypto.randomUUID()
    persistLoops([...loops, { id, startSec: a, endSec: b }])
    setDraftStart(null)
    setDraftEnd(null)
  }, [draftStart, draftEnd, duration, loops, persistLoops])

  const applyLoopTimeDraft = useCallback(
    (id: string) => {
      const draft = loopTimeDraftById[id]
      if (!draft) return
      let a = parseFloat(draft.start)
      let b = parseFloat(draft.end)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return
      if (a > b) [a, b] = [b, a]
      const d = duration
      if (Number.isFinite(d) && d > 0) {
        a = Math.max(0, a)
        b = Math.min(b, d)
      } else {
        a = Math.max(0, a)
        b = Math.max(0, b)
      }
      if (b - a < VIDEO_AB_LOOP_EPS) return
      persistLoops(
        loops.map(l => (l.id === id ? { ...l, startSec: a, endSec: b } : l))
      )
    },
    [loopTimeDraftById, duration, loops, persistLoops]
  )

  const setLoopDraftStartFromPlayhead = useCallback((id: string) => {
    const el = videoRef.current
    if (!el) return
    const t = el.currentTime
    setLoopTimeDraftById(prev => {
      const cur = prev[id] ?? { start: '0', end: '0' }
      return { ...prev, [id]: { ...cur, start: String(t) } }
    })
  }, [])

  const setLoopDraftEndFromPlayhead = useCallback((id: string) => {
    const el = videoRef.current
    if (!el) return
    const t = el.currentTime
    setLoopTimeDraftById(prev => {
      const cur = prev[id] ?? { start: '0', end: '0' }
      return { ...prev, [id]: { ...cur, end: String(t) } }
    })
  }, [])

  const deleteLoop = useCallback(
    (id: string) => {
      persistLoops(loops.filter(l => l.id !== id))
      if (activeLoopId === id) setActiveLoopId(null)
    },
    [loops, persistLoops, activeLoopId]
  )

  const cancelTrimExport = useCallback(() => {
    trimAbortRef.current?.abort()
    terminateFFmpeg()
  }, [])

  const exportTrimForLoop = useCallback(
    async (loop: VideoLoop) => {
      if (trimBusyRef.current) return
      trimBusyRef.current = true
      setTrimError(null)
      setTrimReport(null)
      const ac = new AbortController()
      trimAbortRef.current = ac
      setExportingLoopId(loop.id)
      trimEverStartedRef.current = true
      setTrimProgress(0)
      try {
        const file = await fileHandle.getFile()
        if (file.size > MAX_TRIM_INPUT_BYTES) {
          setTrimError(
            `This file is too large to trim here (max ${formatBytes(MAX_TRIM_INPUT_BYTES)}).`
          )
          return
        }
        const bytes = await trimVideoStreamCopy({
          file,
          startSec: loop.startSec,
          endSec: loop.endSec,
          onProgress: p => setTrimProgress(p),
          signal: ac.signal,
        })
        const blob = new Blob([new Uint8Array(bytes)], {
          type: file.type && file.type.startsWith('video/')
            ? file.type
            : 'application/octet-stream',
        })
        const suggested = trimmedFilenameSuggestion(fileName)
        const saveLocation = await saveTrimmedVideoBlob(
          blob,
          suggested,
          saveDirectoryHandle
        )
        setTrimReport({
          originalBytes: file.size,
          outputBytes: blob.size,
          saveLocation,
        })
        onTrimExported?.()
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setTrimError('Trim cancelled.')
        } else {
          setTrimError(e instanceof Error ? e.message : 'Trim failed.')
        }
      } finally {
        trimBusyRef.current = false
        trimAbortRef.current = null
        setExportingLoopId(null)
        setTrimProgress(0)
      }
    },
    [fileHandle, fileName, saveDirectoryHandle, onTrimExported]
  )

  const { isTopOfStack } = useModalEscape(true, onClose)

  useEffect(() => {
    if (!isTopOfStack) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return
      if (keyboardTargetIsEditable(e.target)) return
      if (e.key === 'ArrowLeft' && onNavigateSibling) {
        e.preventDefault()
        onNavigateSibling(-1)
        return
      }
      if (e.key === 'ArrowRight' && onNavigateSibling) {
        e.preventDefault()
        onNavigateSibling(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNavigateSibling, isTopOfStack])

  useEffect(() => {
    return () => {
      if (trimAbortRef.current) trimAbortRef.current.abort()
      if (trimEverStartedRef.current) terminateFFmpeg()
    }
  }, [])

  const runDelete = useCallback(async () => {
    if (!onDelete || deleteBusy) return
    setDeleteBusy(true)
    try {
      await Promise.resolve(onDelete())
    } finally {
      setDeleteBusy(false)
    }
  }, [onDelete, deleteBusy])

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={dialogRef} class="relative max-h-[90vh] max-w-[min(96vw,1200px)] overflow-auto rounded-xl border border-zinc-600 bg-zinc-950 shadow-2xl">
        {onDelete ? (
          <button
            type="button"
            class="absolute left-2 top-2 z-10 rounded-md border border-rose-600/70 bg-rose-950/90 px-3 py-1 text-sm text-rose-100 hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={deleteBusy}
            onClick={() => {
              void runDelete()
            }}
          >
            {deleteBusy ? 'Deleting…' : 'Delete'}
          </button>
        ) : null}
        {onScrubMetadata ? (
          <button
            type="button"
            class="absolute left-24 top-2 z-10 rounded-md border border-zinc-600 bg-zinc-900/90 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
            onClick={onScrubMetadata}
          >
            Scrub…
          </button>
        ) : null}
        <button
          type="button"
          class="absolute right-2 top-2 z-10 rounded-md bg-zinc-800 px-3 py-1 text-sm text-zinc-100 hover:bg-zinc-700"
          onClick={onClose}
        >
          Close
        </button>
        <div class="border-b border-zinc-800/80 px-4 pb-3 pt-12">
          <h2
            id="preview-modal-title"
            class="truncate text-center text-sm font-medium text-zinc-100"
            title={fileName}
          >
            {fileName}
          </h2>
        </div>
        <div class="p-4">
          <div class="mb-3 flex flex-wrap items-center gap-1.5 border-b border-zinc-800/80 pb-3">
            <span class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Quick add
            </span>
            {recentTagsStrip.map(tag => {
              const has = tags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  disabled={has}
                  class={
                    has
                      ? 'cursor-default rounded-full border border-zinc-700/50 bg-zinc-800/40 px-2 py-0.5 text-[11px] text-zinc-500'
                      : 'rounded-full border border-zinc-600 bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700'
                  }
                  onClick={() => onApplyFrequentTag(tag)}
                >
                  {tag}
                </button>
              )
            })}
            <MoreTagsQuickAddDropdown
              tags={moreTags}
              placement="below"
              panelZClass="z-20"
              triggerClassName="cursor-pointer rounded-full border border-zinc-600 bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
              panelClassName="max-h-48 min-w-[12rem] overflow-y-auto rounded-lg border border-zinc-600 bg-zinc-900 py-1 shadow-xl"
              optionClassName="block w-full px-3 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-zinc-800"
              optionPrefix=""
              onSelect={onApplyFrequentTag}
              triggerChildren={
                <>
                  More <span class="text-zinc-500" aria-hidden>▾</span>
                </>
              }
            />
            <button
              ref={newTagTriggerRef}
              type="button"
              class="cursor-pointer rounded-full border border-zinc-600 bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
              aria-label="New tag"
              onClick={() => setNewTagDialogOpen(true)}
            >
              + New
            </button>
          </div>
          {tags.length > 0 ? (
            <div class="mb-3 flex flex-wrap gap-1">
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
          {!url ? (
            <p class="px-8 py-12 text-center text-zinc-400">Loading…</p>
          ) : kind === 'image' ? (
            <img
              src={url}
              alt=""
              class="mx-auto max-h-[80vh] max-w-full object-contain"
            />
          ) : (
            <div class="flex flex-col gap-4">
              <video
                ref={videoRef}
                src={url}
                controls
                autoPlay
                muted
                playsInline
                loop={!activeLoop}
                class="mx-auto max-h-[min(70vh,800px)] max-w-full"
                onLoadedMetadata={e => {
                  const t = e.currentTarget.duration
                  setDuration(Number.isFinite(t) ? t : 0)
                }}
                onLoadedData={e => {
                  if (!e.currentTarget.isConnected) return
                  void e.currentTarget.play().catch(() => {
                    /* muted autoplay usually allowed; unmuted may need gesture */
                  })
                }}
              />
              <div class="rounded-lg border border-zinc-700/80 bg-zinc-900/50 px-3 py-2">
                  <div class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    Loops
                  </div>
                  <p class="mb-2 text-[11px] leading-snug text-zinc-500">
                    Export trim uses ffmpeg (stream copy): fast; cut points align
                    to keyframes. Estimated sizes assume similar quality across
                    the timeline — actual output may differ.
                  </p>
                  {fileSizeBytes > MAX_TRIM_INPUT_BYTES ? (
                    <p class="mb-2 text-xs text-amber-600/90">
                      This file exceeds the {formatBytes(MAX_TRIM_INPUT_BYTES)} trim limit.
                    </p>
                  ) : null}
                  {trimError ? (
                    <p class="mb-2 text-xs text-red-400">{trimError}</p>
                  ) : null}
                  {trimReport ? (
                    <div class="mb-3 rounded border border-emerald-800/80 bg-emerald-950/30 px-2 py-2 text-[11px] text-zinc-300">
                      <div class="font-medium text-emerald-400/90">
                        Trim saved
                      </div>
                      <div class="mt-1 tabular-nums">
                        Original: {formatBytes(trimReport.originalBytes)} ·
                        Trimmed: {formatBytes(trimReport.outputBytes)} · Saved:{' '}
                        {formatBytes(
                          Math.max(0, trimReport.originalBytes - trimReport.outputBytes)
                        )}{' '}
                        (
                        {trimReport.originalBytes > 0
                          ? `${(((trimReport.originalBytes - trimReport.outputBytes) / trimReport.originalBytes) * 100).toFixed(1)}%`
                          : '—'}{' '}
                        of original)
                      </div>
                      {trimReport.saveLocation === 'saveAsPicker' ? (
                        <p class="mt-1 text-zinc-500">
                          Net disk space won&apos;t shrink until you remove the
                          original (or the copy you don&apos;t need).
                        </p>
                      ) : (
                        <p class="mt-1 text-zinc-500">
                          New file:{' '}
                          <span class="text-zinc-400">
                            {trimmedFilenameSuggestion(fileName)}
                          </span>{' '}
                          in the current folder.
                        </p>
                      )}
                    </div>
                  ) : null}
                  {exportingLoopId !== null ? (
                    <div class="mb-2 flex flex-wrap items-center gap-2">
                      <div class="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded bg-zinc-800">
                        <div
                          class="h-full bg-sky-600 transition-[width]"
                          style={{
                            width: `${Math.round(trimProgress * 100)}%`,
                          }}
                        />
                      </div>
                      <span class="text-[11px] tabular-nums text-zinc-500">
                        {Math.round(trimProgress * 100)}%
                      </span>
                      <button
                        type="button"
                        class="rounded border border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                        onClick={cancelTrimExport}
                      >
                        Cancel trim
                      </button>
                    </div>
                  ) : null}
                  <div class="mb-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
                      onClick={markDraftStart}
                    >
                      Start at current
                    </button>
                    <button
                      type="button"
                      class="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
                      onClick={markDraftEnd}
                    >
                      End at current
                    </button>
                    <button
                      type="button"
                      class="rounded bg-emerald-700/90 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
                      disabled={
                        draftStart === null ||
                        draftEnd === null ||
                        Math.abs(draftEnd - draftStart) < VIDEO_AB_LOOP_EPS
                      }
                      onClick={saveDraftLoop}
                    >
                      Save loop
                    </button>
                    <span class="text-[11px] text-zinc-500">
                      {draftStart !== null
                        ? `Start ${formatMediaTime(draftStart)}`
                        : 'Start —'}
                      {' · '}
                      {draftEnd !== null
                        ? `End ${formatMediaTime(draftEnd)}`
                        : 'End —'}
                    </span>
                  </div>
                  {loops.length === 0 ? (
                    <p class="text-xs text-zinc-500">
                      Mark start and end times, then save a loop.
                    </p>
                  ) : (
                    <ul class="flex flex-col gap-2">
                      {loops.map(loop => {
                        const est = estimateTrimSavingsBytes(
                          fileSizeBytes,
                          duration,
                          loop.startSec,
                          loop.endSec
                        )
                        const draft = loopTimeDraftById[loop.id] ?? {
                          start: String(loop.startSec),
                          end: String(loop.endSec),
                        }
                        return (
                          <li
                            key={loop.id}
                            class="flex flex-col gap-2 rounded border border-zinc-800/80 bg-zinc-950/60 px-2 py-2"
                          >
                            <div class="flex flex-wrap items-start justify-between gap-2">
                              <div class="min-w-0 flex-1">
                                <span class="tabular-nums text-xs text-zinc-300">
                                  {formatMediaTime(loop.startSec)} –{' '}
                                  {formatMediaTime(loop.endSec)}
                                </span>
                                {est && fileSizeBytes > 0 ? (
                                  <div class="mt-0.5 text-[10px] text-zinc-500">
                                    Est. smaller by ~{formatBytes(est.estimatedSavingsBytes)}{' '}
                                    (~
                                    {(
                                      (est.estimatedSavingsBytes / fileSizeBytes) *
                                      100
                                    ).toFixed(0)}
                                    % of file) if quality stays similar
                                  </div>
                                ) : null}
                              </div>
                              <span class="flex flex-wrap gap-1">
                                {activeLoopId === loop.id ? (
                                  <button
                                    type="button"
                                    class="rounded bg-amber-700/80 px-2 py-0.5 text-[11px] text-white hover:bg-amber-600"
                                    onClick={() => setActiveLoopId(null)}
                                  >
                                    Stop loop
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    class="rounded bg-sky-700/80 px-2 py-0.5 text-[11px] text-white hover:bg-sky-600"
                                    onClick={() => setActiveLoopId(loop.id)}
                                  >
                                    Play loop
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={
                                    exportingLoopId !== null ||
                                    fileSizeBytes > MAX_TRIM_INPUT_BYTES
                                  }
                                  class="rounded border border-violet-600/80 px-2 py-0.5 text-[11px] text-violet-200 hover:bg-violet-950/60 disabled:cursor-not-allowed disabled:opacity-40"
                                  onClick={() => void exportTrimForLoop(loop)}
                                  title="Save a new file with this range (stream copy)"
                                >
                                  {exportingLoopId === loop.id
                                    ? 'Exporting…'
                                    : 'Export trim'}
                                </button>
                                {onAddLoopToViewer ? (
                                  <button
                                    type="button"
                                    class="rounded border border-emerald-700/70 px-2 py-0.5 text-[11px] text-emerald-200 hover:bg-emerald-950/50"
                                    onClick={() => onAddLoopToViewer(loop)}
                                    title="Play this range in the Viewer pane"
                                  >
                                    Add to Viewer
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  class="rounded border border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                                  onClick={() => deleteLoop(loop.id)}
                                >
                                  Delete
                                </button>
                              </span>
                            </div>
                            <div class="flex flex-wrap items-end gap-2 border-t border-zinc-800/50 pt-2">
                              <label class="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                                Start (s)
                                <input
                                  type="number"
                                  step="any"
                                  min={0}
                                  class="w-[5.5rem] rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-200"
                                  value={draft.start}
                                  onInput={e => {
                                    const v = (e.target as HTMLInputElement).value
                                    setLoopTimeDraftById(prev => ({
                                      ...prev,
                                      [loop.id]: {
                                        ...(prev[loop.id] ?? draft),
                                        start: v,
                                      },
                                    }))
                                  }}
                                />
                              </label>
                              <label class="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                                End (s)
                                <input
                                  type="number"
                                  step="any"
                                  min={0}
                                  class="w-[5.5rem] rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-200"
                                  value={draft.end}
                                  onInput={e => {
                                    const v = (e.target as HTMLInputElement).value
                                    setLoopTimeDraftById(prev => ({
                                      ...prev,
                                      [loop.id]: {
                                        ...(prev[loop.id] ?? draft),
                                        end: v,
                                      },
                                    }))
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                class="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
                                onClick={() => applyLoopTimeDraft(loop.id)}
                              >
                                Apply times
                              </button>
                              <button
                                type="button"
                                class="rounded border border-zinc-600 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800"
                                onClick={() => setLoopDraftStartFromPlayhead(loop.id)}
                              >
                                Start ← playhead
                              </button>
                              <button
                                type="button"
                                class="rounded border border-zinc-600 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800"
                                onClick={() => setLoopDraftEndFromPlayhead(loop.id)}
                              >
                                End ← playhead
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
            </div>
          )}
        </div>
      </div>
      <NewTagQuickAddDialog
        open={newTagDialogOpen}
        onClose={() => setNewTagDialogOpen(false)}
        onSubmit={onApplyFrequentTag}
        triggerRef={newTagTriggerRef}
      />
    </div>
  )
}

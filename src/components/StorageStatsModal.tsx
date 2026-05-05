import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { formatBytes } from '../lib/format-bytes'
import {
  computeStorageStats,
  type StorageStatsProgress,
  type StorageStatsReport,
} from '../lib/storage-stats'
import { useFocusTrap } from '../lib/use-focus-trap'
import { ProgressBar } from './ProgressBar.tsx'

type StorageStatsModalProps = {
  rootHandle: FileSystemDirectoryHandle
  rootName: string
  onClose: () => void
}

type Phase = 'intro' | 'running' | 'done'

function pct(part: number, total: number): number {
  if (total <= 0 || !Number.isFinite(total)) return 0
  return Math.min(100, Math.round((part / total) * 1000) / 10)
}

function BarRow({
  label,
  bytes,
  total,
  accentClass,
}: {
  label: string
  bytes: number
  total: number
  accentClass: string
}) {
  const p = pct(bytes, total)
  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-baseline justify-between gap-3 text-xs">
        <span class="min-w-0 truncate font-medium text-zinc-200" title={label}>
          {label}
        </span>
        <span class="shrink-0 tabular-nums text-zinc-400">
          {formatBytes(bytes)}{' '}
          <span class="text-zinc-600">({p}%)</span>
        </span>
      </div>
      <div class="h-2 overflow-hidden rounded-full bg-zinc-800/80">
        <div
          class={`h-full rounded-full transition-[width] duration-300 ${accentClass}`}
          style={{ width: `${p}%` }}
        />
      </div>
    </div>
  )
}

export function StorageStatsModal({
  rootHandle,
  rootName,
  onClose,
}: StorageStatsModalProps) {
  const [phase, setPhase] = useState<Phase>('intro')
  const [progress, setProgress] = useState<StorageStatsProgress | null>(null)
  const [report, setReport] = useState<StorageStatsReport | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, phase !== 'running')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'running') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onClose])

  const run = useCallback(async () => {
    setRunError(null)
    setPhase('running')
    setProgress({ filesScanned: 0, dirsVisited: 0, bytesSoFar: 0 })
    setReport(null)
    try {
      const r = await computeStorageStats(rootHandle, {
        onProgress: setProgress,
        progressEvery: 32,
      })
      setReport(r)
      setPhase('done')
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e))
      setPhase('intro')
    } finally {
      setProgress(null)
    }
  }, [rootHandle])

  const total = report?.totalBytes ?? 0

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="storage-stats-title"
      onClick={e => {
        if (e.target === e.currentTarget && phase !== 'running') onClose()
      }}
    >
      <div ref={dialogRef} class="flex max-h-[min(92vh,48rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700/80 bg-gradient-to-b from-zinc-950 to-zinc-950/95 shadow-2xl ring-1 ring-white/5">
        <div class="border-b border-zinc-800/80 px-6 py-5">
          <h2
            id="storage-stats-title"
            class="text-xl font-semibold tracking-tight text-zinc-50"
          >
            Storage report
          </h2>
          <p class="mt-1.5 text-sm leading-relaxed text-zinc-500">
            Full scan of <span class="font-medium text-zinc-400">“{rootName}”</span>
            — every file is measured. Large folders can take a while.
          </p>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {phase === 'intro' ? (
            <div class="flex flex-col gap-4">
              <p class="text-sm text-zinc-400">
                Results group storage by{' '}
                <span class="text-zinc-300">image / video / other</span>, by{' '}
                <span class="text-zinc-300">file extension</span>, and by{' '}
                <span class="text-zinc-300">tag</span> (files with several tags
                count toward each tag). Untagged bytes are listed separately.
              </p>
              {runError ? (
                <p class="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                  {runError}
                </p>
              ) : null}
              <button
                type="button"
                class="inline-flex items-center justify-center rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-950/40 transition hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-zinc-950"
                onClick={run}
              >
                Scan folder
              </button>
            </div>
          ) : null}

          {phase === 'running' && progress ? (
            <div class="flex flex-col gap-4">
              <p class="text-sm text-zinc-400">Scanning…</p>
              <ProgressBar indeterminate />
              <p class="text-[11px] tabular-nums text-zinc-500">
                {progress.filesScanned.toLocaleString()} files ·{' '}
                {progress.dirsVisited.toLocaleString()} folders ·{' '}
                {formatBytes(progress.bytesSoFar)} so far
              </p>
            </div>
          ) : null}

          {phase === 'done' && report ? (
            <div class="flex flex-col gap-8">
              <div class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
                <p class="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Total
                </p>
                <p class="mt-1 font-mono text-4xl font-semibold tabular-nums tracking-tight text-zinc-50">
                  {formatBytes(report.totalBytes)}
                </p>
                <p class="mt-2 text-sm text-zinc-500">
                  {report.fileCount.toLocaleString()} file
                  {report.fileCount === 1 ? '' : 's'}
                </p>
              </div>

              <section>
                <h3 class="mb-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  By kind
                </h3>
                <div class="grid gap-4 sm:grid-cols-3">
                  <div class="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-4">
                    <p class="text-[10px] font-medium uppercase tracking-wide text-emerald-500/90">
                      Images
                    </p>
                    <p class="mt-2 font-mono text-lg font-semibold tabular-nums text-emerald-100">
                      {formatBytes(report.byKind.image)}
                    </p>
                    <p class="mt-1 text-xs text-emerald-600/90">
                      {pct(report.byKind.image, total)}% of total
                    </p>
                  </div>
                  <div class="rounded-xl border border-violet-900/40 bg-violet-950/20 p-4">
                    <p class="text-[10px] font-medium uppercase tracking-wide text-violet-400/90">
                      Videos
                    </p>
                    <p class="mt-2 font-mono text-lg font-semibold tabular-nums text-violet-100">
                      {formatBytes(report.byKind.video)}
                    </p>
                    <p class="mt-1 text-xs text-violet-500/90">
                      {pct(report.byKind.video, total)}% of total
                    </p>
                  </div>
                  <div class="rounded-xl border border-zinc-700/80 bg-zinc-900/50 p-4">
                    <p class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      Other files
                    </p>
                    <p class="mt-2 font-mono text-lg font-semibold tabular-nums text-zinc-200">
                      {formatBytes(report.byKind.other)}
                    </p>
                    <p class="mt-1 text-xs text-zinc-600">
                      {pct(report.byKind.other, total)}% of total
                    </p>
                  </div>
                </div>
              </section>

              <section>
                <h3 class="mb-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  By file extension
                </h3>
                {report.byExtension.length === 0 ? (
                  <p class="text-sm text-zinc-600">No files found.</p>
                ) : (
                  <div class="flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
                    {report.byExtension.map(row => (
                      <BarRow
                        key={row.ext}
                        label={row.ext}
                        bytes={row.bytes}
                        total={total}
                        accentClass="bg-gradient-to-r from-sky-700 to-sky-500"
                      />
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 class="mb-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  By tag
                </h3>
                <div class="mb-4 rounded-xl border border-amber-900/30 bg-amber-950/15 p-4">
                  <div class="flex items-baseline justify-between gap-3 text-sm">
                    <span class="font-medium text-amber-200/90">Untagged</span>
                    <span class="tabular-nums text-amber-100/80">
                      {formatBytes(report.untaggedBytes)}
                      <span class="ml-2 text-xs text-amber-600/90">
                        ({pct(report.untaggedBytes, total)}%)
                      </span>
                    </span>
                  </div>
                  <p class="mt-2 text-[11px] leading-snug text-amber-700/80">
                    Files with no tags in your index (non-media files are often
                    untagged).
                  </p>
                </div>
                {report.byTag.length === 0 ? (
                  <p class="text-sm text-zinc-600">No tagged files.</p>
                ) : (
                  <div class="flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
                    {report.byTag.map(row => (
                      <BarRow
                        key={row.tag}
                        label={row.tag}
                        bytes={row.bytes}
                        total={total}
                        accentClass="bg-gradient-to-r from-amber-800 to-amber-600"
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>

        <div class="flex justify-end gap-2 border-t border-zinc-800/80 bg-zinc-950/80 px-6 py-4">
          {phase === 'done' ? (
            <button
              type="button"
              class="rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
              onClick={run}
            >
              Scan again
            </button>
          ) : null}
          <button
            type="button"
            class="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onClose}
            disabled={phase === 'running'}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

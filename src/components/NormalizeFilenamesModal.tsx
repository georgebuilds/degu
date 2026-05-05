import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  runNormalizeFilenames,
  type NormalizeProgress,
  type NormalizeReport,
} from '../lib/normalize-filenames'
import { useFocusTrap } from '../lib/use-focus-trap'
import { ProgressBar } from './ProgressBar.tsx'

type NormalizeFilenamesModalProps = {
  rootHandle: FileSystemDirectoryHandle
  onClose: () => void
  onComplete: (report: NormalizeReport) => void
}

type Phase = 'configure' | 'running' | 'report'

export function NormalizeFilenamesModal({
  rootHandle,
  onClose,
  onComplete,
}: NormalizeFilenamesModalProps) {
  const [phase, setPhase] = useState<Phase>('configure')
  const [rows, setRows] = useState<string[]>([''])
  const [report, setReport] = useState<NormalizeReport | null>(null)
  const [progress, setProgress] = useState<NormalizeProgress | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const runAbortRef = useRef<AbortController | null>(null)
  useFocusTrap(dialogRef, phase !== 'running')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (phase === 'configure' || phase === 'report') {
        onClose()
      } else if (phase === 'running') {
        runAbortRef.current?.abort()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onClose])

  const run = useCallback(async () => {
    setRunError(null)
    setPhase('running')
    setProgress({ phase: 'collect', done: 0, total: 0 })
    const ac = new AbortController()
    runAbortRef.current = ac
    try {
      const r = await runNormalizeFilenames(rootHandle, rows, {
        signal: ac.signal,
        onProgress: p => setProgress(p),
      })
      setReport(r)
      setPhase('report')
      onComplete(r)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        onClose()
        return
      }
      setRunError(e instanceof Error ? e.message : String(e))
      setPhase('configure')
    } finally {
      setProgress(null)
      runAbortRef.current = null
    }
  }, [rootHandle, rows, onClose, onComplete])

  const closeReport = useCallback(() => {
    onClose()
  }, [onClose])

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="normalize-modal-title"
      onClick={e => {
        if (phase === 'configure' && e.target === e.currentTarget) onClose()
        if (phase === 'report' && e.target === e.currentTarget) closeReport()
      }}
    >
      <div ref={dialogRef} class="w-full max-w-md rounded-xl border border-zinc-600 bg-zinc-950 p-5 shadow-2xl">
        <h2
          id="normalize-modal-title"
          class="mb-1 text-lg font-semibold text-zinc-100"
        >
          Normalize filenames
        </h2>
        <p class="mb-4 text-sm text-zinc-500">
          Remove substrings from each media file&apos;s name (not folder names).
          Substrings are removed in order; all occurrences of each are removed.
        </p>

        {phase === 'configure' ? (
          <>
            <div class="mb-3 flex flex-col gap-2">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Strings to remove
              </span>
              {rows.map((row, i) => (
                <div key={i} class="flex gap-2">
                  <input
                    type="text"
                    class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
                    placeholder="e.g. copy, _01"
                    value={row}
                    onInput={e => {
                      const v = (e.target as HTMLInputElement).value
                      setRows(prev => {
                        const next = [...prev]
                        next[i] = v
                        return next
                      })
                    }}
                  />
                  <button
                    type="button"
                    class="shrink-0 rounded-md border border-zinc-600 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
                    disabled={rows.length <= 1}
                    onClick={() =>
                      setRows(prev => prev.filter((_, j) => j !== i))
                    }
                    aria-label="Remove row"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                class="rounded-md border border-dashed border-zinc-700 py-1.5 text-xs text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                onClick={() => setRows(prev => [...prev, ''])}
              >
                + Add string
              </button>
            </div>
            {runError ? (
              <p class="mb-3 text-sm text-rose-400">{runError}</p>
            ) : null}
            <div class="mt-6 flex justify-end gap-2">
              <button
                type="button"
                class="rounded-md border border-zinc-600 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
                onClick={() => void run()}
              >
                Run
              </button>
            </div>
          </>
        ) : null}

        {phase === 'running' ? (
          <div class="py-2">
            <p class="mb-3 text-sm text-zinc-400">
              {progress?.phase === 'collect'
                ? 'Scanning folders…'
                : progress && progress.total > 0
                  ? `Renaming… ${progress.done} / ${progress.total}`
                  : 'Working…'}
            </p>
            {progress?.phase === 'run' && progress.total > 0 ? (
              <ProgressBar
                percent={(100 * progress.done) / Math.max(1, progress.total)}
              />
            ) : (
              <ProgressBar indeterminate />
            )}
            <div class="mt-4 flex justify-end">
              <button
                type="button"
                class="rounded-md border border-zinc-600 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                onClick={() => runAbortRef.current?.abort()}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'report' && report ? (
          <>
            <ul class="mb-4 space-y-1.5 text-sm text-zinc-300">
              <li>
                <span class="text-zinc-500">Renamed:</span>{' '}
                {report.renamed.toLocaleString()}
              </li>
              <li>
                <span class="text-zinc-500">Unchanged:</span>{' '}
                {report.unchanged.toLocaleString()}
              </li>
              <li>
                <span class="text-zinc-500">Skipped (name taken):</span>{' '}
                {report.skippedCollision.toLocaleString()}
              </li>
              <li>
                <span class="text-zinc-500">Skipped (invalid name):</span>{' '}
                {report.skippedInvalid.toLocaleString()}
              </li>
              <li>
                <span class="text-zinc-500">Failed:</span>{' '}
                {report.failed.length.toLocaleString()}
              </li>
            </ul>
            {report.failed.length > 0 ? (
              <div class="mb-4 max-h-40 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900/80 p-2 text-xs">
                {report.failed.map((f, i) => (
                  <p key={i} class="break-all text-rose-300/90">
                    {f.path}: {f.message}
                  </p>
                ))}
              </div>
            ) : null}
            {report.tagIndexFlushError ? (
              <p class="mb-4 text-sm text-rose-300">
                Tag index could not be saved: {report.tagIndexFlushError}. Files were renamed; tag entries still reference the old names.
              </p>
            ) : null}
            <div class="flex justify-end">
              <button
                type="button"
                class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
                onClick={closeReport}
              >
                Done
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

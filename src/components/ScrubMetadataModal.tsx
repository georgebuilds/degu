import { useCallback, useMemo, useRef, useState } from 'preact/hooks'
import {
  runScrubMetadata,
  MODIFIABLE_FIELDS,
  type MetadataField,
  type ScrubAction,
  type ScrubProgress,
  type ScrubReport,
  type ScrubTarget,
} from '../lib/scrub-metadata'
import { useFocusTrap } from '../lib/use-focus-trap'
import { ProgressBar } from './ProgressBar.tsx'
import { useModalEscape } from './use-modal-stack.ts'

type ScrubMetadataModalProps = {
  rootHandle: FileSystemDirectoryHandle
  /** What to scrub. The caller decides; modal only needs to know how to render the label. */
  target: ScrubTarget
  /** Human label shown in the modal header, e.g. "All media" or "vacation.mp4". */
  targetLabel: string
  onClose: () => void
  onComplete: (report: ScrubReport) => void
}

type Phase = 'configure' | 'running' | 'report'
type Mode = 'strip' | 'modify'

function emptyField(): MetadataField {
  return { key: 'title', value: '' }
}

export function ScrubMetadataModal({
  rootHandle,
  target,
  targetLabel,
  onClose,
  onComplete,
}: ScrubMetadataModalProps) {
  const [phase, setPhase] = useState<Phase>('configure')
  const [mode, setMode] = useState<Mode>('strip')
  const [fields, setFields] = useState<MetadataField[]>([emptyField()])
  const [report, setReport] = useState<ScrubReport | null>(null)
  const [progress, setProgress] = useState<ScrubProgress | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const runAbortRef = useRef<AbortController | null>(null)
  useFocusTrap(dialogRef, phase !== 'running')

  useModalEscape(true, () => {
    if (phase === 'configure' || phase === 'report') {
      onClose()
    } else if (phase === 'running') {
      runAbortRef.current?.abort()
    }
  })

  const validModifyFields = useMemo(
    () => fields.filter(f => f.key.trim() && f.value !== ''),
    [fields]
  )

  const canRun =
    mode === 'strip' || (mode === 'modify' && validModifyFields.length > 0)

  const run = useCallback(async () => {
    const action: ScrubAction =
      mode === 'strip'
        ? { mode: 'strip' }
        : { mode: 'modify', fields: validModifyFields }

    setRunError(null)
    setPhase('running')
    setProgress({ phase: 'collect', done: 0, total: 0 })
    const ac = new AbortController()
    runAbortRef.current = ac
    try {
      const r = await runScrubMetadata(rootHandle, target, action, {
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
  }, [rootHandle, target, mode, validModifyFields, onClose, onComplete])

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scrub-modal-title"
      onClick={e => {
        if (phase === 'configure' && e.target === e.currentTarget) onClose()
        if (phase === 'report' && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        class="w-full max-w-md rounded-xl border border-zinc-600 bg-zinc-950 p-5 shadow-2xl"
      >
        <h2 id="scrub-modal-title" class="mb-1 text-lg font-semibold text-zinc-100">
          Scrub metadata
        </h2>
        <p class="mb-4 truncate text-sm text-zinc-500" title={targetLabel}>
          Target: <span class="text-zinc-300">{targetLabel}</span>
        </p>

        {phase === 'configure' ? (
          <>
            <fieldset class="mb-4">
              <legend class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Action
              </legend>
              <div class="space-y-2">
                <label class="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 p-2.5 hover:border-zinc-700">
                  <input
                    type="radio"
                    name="scrub-mode"
                    class="mt-0.5 accent-sky-500"
                    checked={mode === 'strip'}
                    onChange={() => setMode('strip')}
                  />
                  <span class="flex-1">
                    <span class="block text-sm font-medium text-zinc-100">
                      Strip all metadata
                    </span>
                    <span class="mt-0.5 block text-xs text-zinc-500">
                      Removes EXIF (incl. GPS), camera info, capture date,
                      software, copyright, comments, embedded thumbnails.
                    </span>
                  </span>
                </label>
                <label class="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 p-2.5 hover:border-zinc-700">
                  <input
                    type="radio"
                    name="scrub-mode"
                    class="mt-0.5 accent-sky-500"
                    checked={mode === 'modify'}
                    onChange={() => setMode('modify')}
                  />
                  <span class="flex-1">
                    <span class="block text-sm font-medium text-zinc-100">
                      Modify metadata
                    </span>
                    <span class="mt-0.5 block text-xs text-zinc-500">
                      Set or overwrite specific fields. Other metadata is
                      preserved.{' '}
                      <span class="text-amber-400/90">
                        Video only in this version — images will be skipped.
                      </span>
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            {mode === 'strip' ? (
              <div class="mb-4 rounded-md border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-200/90">
                Some phone photos may appear rotated after stripping. Open one
                to check before bulk-scrubbing irreplaceable shots.
              </div>
            ) : (
              <div class="mb-4 flex flex-col gap-2">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Fields to set
                </span>
                {fields.map((row, i) => (
                  <div key={i} class="flex gap-2">
                    <select
                      class="w-32 shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
                      value={row.key}
                      onChange={e => {
                        const v = (e.target as HTMLSelectElement).value
                        setFields(prev => {
                          const next = [...prev]
                          next[i] = { ...next[i]!, key: v }
                          return next
                        })
                      }}
                    >
                      {MODIFIABLE_FIELDS.map(f => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
                      placeholder="Value"
                      value={row.value}
                      onInput={e => {
                        const v = (e.target as HTMLInputElement).value
                        setFields(prev => {
                          const next = [...prev]
                          next[i] = { ...next[i]!, value: v }
                          return next
                        })
                      }}
                    />
                    <button
                      type="button"
                      class="shrink-0 rounded-md border border-zinc-600 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
                      disabled={fields.length <= 1}
                      onClick={() =>
                        setFields(prev => prev.filter((_, j) => j !== i))
                      }
                      aria-label="Remove field"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  class="rounded-md border border-dashed border-zinc-700 py-1.5 text-xs text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                  onClick={() => setFields(prev => [...prev, emptyField()])}
                >
                  + Add field
                </button>
              </div>
            )}

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
                class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canRun}
                onClick={() => void run()}
              >
                Run
              </button>
            </div>
          </>
        ) : null}

        {phase === 'running' ? (
          <div class="py-2">
            <p class="mb-3 truncate text-sm text-zinc-400" title={progress?.currentPath}>
              {progress?.phase === 'collect'
                ? 'Scanning folders…'
                : progress && progress.total > 0
                  ? `Scrubbing… ${progress.done} / ${progress.total}${
                      progress.currentPath ? ` · ${progress.currentPath}` : ''
                    }`
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
                <span class="text-zinc-500">Scrubbed:</span>{' '}
                {report.scrubbed.toLocaleString()}
              </li>
              {report.skippedUnsupported > 0 ? (
                <li>
                  <span class="text-zinc-500">Skipped (unsupported format):</span>{' '}
                  {report.skippedUnsupported.toLocaleString()}
                </li>
              ) : null}
              {report.skippedModifyImage > 0 ? (
                <li>
                  <span class="text-zinc-500">
                    Skipped (modify is video-only):
                  </span>{' '}
                  {report.skippedModifyImage.toLocaleString()}
                </li>
              ) : null}
              {report.skippedTooLarge > 0 ? (
                <li>
                  <span class="text-zinc-500">Skipped (too large):</span>{' '}
                  {report.skippedTooLarge.toLocaleString()}
                </li>
              ) : null}
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
            <div class="flex justify-end">
              <button
                type="button"
                class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
                onClick={onClose}
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

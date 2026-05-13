import { useCallback, useState } from 'preact/hooks'
import {
  streamLegacyIndexImport,
  type ImportProgress,
  type ImportResult,
  type LegacyIndexStatus,
} from '../lib/legacy-index-api'
import { ProgressBar } from './ProgressBar.tsx'

type MigrationScreenProps = {
  rootFolderName: string
  status: LegacyIndexStatus
  /** Called after import completes (or is skipped) — parent should transition to AppShell. */
  onDone: () => void
  /** Called when the user skips — parent should transition without re-fetching status. */
  onSkip: () => void
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; progress: ImportProgress | null }
  | { kind: 'done'; result: ImportResult }
  | { kind: 'error'; message: string }

export function MigrationScreen({
  rootFolderName,
  status,
  onDone,
  onSkip,
}: MigrationScreenProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const run = useCallback(() => {
    setPhase({ kind: 'running', progress: null })
    void (async () => {
      try {
        const result = await streamLegacyIndexImport({
          onProgress: p => setPhase({ kind: 'running', progress: p }),
        })
        setPhase({ kind: 'done', result })
      } catch (err) {
        setPhase({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()
  }, [])

  return (
    <div class="relative z-10 flex min-h-[100svh] items-center justify-center px-6">
      <div class="flex w-full max-w-xl flex-col gap-5 text-center">
        <span class="font-mono text-[11px] uppercase tracking-[0.28em] text-sky-500">
          degu · legacy index detected
        </span>
        <h1 class="font-mono text-lg font-medium text-zinc-100">
          Import legacy index
        </h1>

        {phase.kind === 'idle' ? (
          <IdleBody
            rootFolderName={rootFolderName}
            entryCount={status.entryCount}
            onImport={run}
            onSkip={onSkip}
          />
        ) : phase.kind === 'running' ? (
          <RunningBody progress={phase.progress} />
        ) : phase.kind === 'done' ? (
          <DoneBody result={phase.result} onContinue={onDone} />
        ) : (
          <ErrorBody message={phase.message} onSkip={onSkip} onRetry={run} />
        )}
      </div>
    </div>
  )
}

function IdleBody({
  rootFolderName,
  entryCount,
  onImport,
  onSkip,
}: {
  rootFolderName: string
  entryCount: number
  onImport: () => void
  onSkip: () => void
}) {
  return (
    <>
      <p class="font-mono text-xs leading-relaxed text-zinc-400">
        We found a legacy <code>index.json</code> in{' '}
        <span class="text-zinc-200">{rootFolderName}</span> with{' '}
        <span class="text-zinc-100">
          {entryCount.toLocaleString()}{' '}
          {entryCount === 1 ? 'entry' : 'entries'}
        </span>
        . Importing checks each path against your folder and drops anything
        missing. The old file is removed afterward.
      </p>
      <div class="mt-2 flex justify-center gap-3">
        <button
          type="button"
          class="rounded-md border border-zinc-700 px-4 py-2 font-mono text-xs text-zinc-400 hover:text-zinc-200"
          onClick={onSkip}
        >
          skip for now
        </button>
        <button
          type="button"
          class="rounded-md border border-sky-500 bg-sky-500/10 px-5 py-2 font-mono text-sm text-sky-300 hover:bg-sky-500/20"
          onClick={onImport}
        >
          import {entryCount.toLocaleString()}{' '}
          {entryCount === 1 ? 'entry' : 'entries'}
        </button>
      </div>
    </>
  )
}

function RunningBody({ progress }: { progress: ImportProgress | null }) {
  const phaseLabel =
    progress?.phase === 'saving'
      ? 'Saving to database…'
      : progress?.phase === 'done'
        ? 'Finishing up…'
        : 'Verifying files…'
  const showPercent =
    progress !== null && progress.phase === 'verifying' && progress.total > 0
  const percent = showPercent
    ? (100 * progress.done) / progress.total
    : 0
  return (
    <>
      <p class="font-mono text-xs leading-relaxed text-zinc-400">
        {phaseLabel}
      </p>
      <div class="mx-auto w-full max-w-sm">
        {showPercent ? (
          <ProgressBar percent={percent} />
        ) : (
          <ProgressBar indeterminate />
        )}
      </div>
      {showPercent ? (
        <p class="font-mono text-[11px] tabular-nums text-zinc-500">
          {progress.done.toLocaleString()} /{' '}
          {progress.total.toLocaleString()}
        </p>
      ) : null}
    </>
  )
}

function DoneBody({
  result,
  onContinue,
}: {
  result: ImportResult
  onContinue: () => void
}) {
  const missingCount = result.missing.length
  return (
    <>
      <p class="font-mono text-xs leading-relaxed text-zinc-400">
        Imported{' '}
        <span class="text-zinc-100">{result.imported.toLocaleString()}</span>{' '}
        {result.imported === 1 ? 'file' : 'files'}.
        {missingCount > 0 ? (
          <>
            {' '}
            <span class="text-zinc-100">
              {missingCount.toLocaleString()}
            </span>{' '}
            {missingCount === 1 ? 'file was' : 'files were'} missing and{' '}
            {missingCount === 1 ? 'was' : 'were'} dropped.
          </>
        ) : null}
        {result.skippedMalformed > 0 ? (
          <>
            {' '}
            <span class="text-zinc-500">
              ({result.skippedMalformed.toLocaleString()} malformed{' '}
              {result.skippedMalformed === 1 ? 'entry' : 'entries'} skipped.)
            </span>
          </>
        ) : null}
      </p>

      {missingCount > 0 ? (
        <details class="mx-auto w-full max-w-md overflow-hidden rounded-lg border border-zinc-800 bg-black/30 text-left font-mono text-[11px] text-zinc-400">
          <summary class="cursor-pointer select-none px-3 py-2 text-zinc-300 hover:text-zinc-100">
            Show {missingCount === 1 ? 'the missing path' : `${missingCount.toLocaleString()} missing paths`}
          </summary>
          <ul class="max-h-64 overflow-y-auto border-t border-zinc-800/80 px-3 py-2 text-zinc-500">
            {result.missing.map(p => (
              <li key={p} class="break-all">
                {p}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div class="mt-2 flex justify-center">
        <button
          type="button"
          class="rounded-md border border-sky-500 bg-sky-500/10 px-5 py-2 font-mono text-sm text-sky-300 hover:bg-sky-500/20"
          onClick={onContinue}
        >
          continue
        </button>
      </div>
    </>
  )
}

function ErrorBody({
  message,
  onSkip,
  onRetry,
}: {
  message: string
  onSkip: () => void
  onRetry: () => void
}) {
  return (
    <>
      <p class="font-mono text-xs leading-relaxed text-rose-300">
        Import failed: {message}
      </p>
      <p class="font-mono text-[11px] leading-relaxed text-zinc-500">
        Your <code>index.json</code> is still on disk; no changes have been
        committed. You can retry, or skip and inspect the file manually.
      </p>
      <div class="mt-2 flex justify-center gap-3">
        <button
          type="button"
          class="rounded-md border border-zinc-700 px-4 py-2 font-mono text-xs text-zinc-400 hover:text-zinc-200"
          onClick={onSkip}
        >
          skip
        </button>
        <button
          type="button"
          class="rounded-md border border-sky-500 bg-sky-500/10 px-5 py-2 font-mono text-sm text-sky-300 hover:bg-sky-500/20"
          onClick={onRetry}
        >
          retry
        </button>
      </div>
    </>
  )
}

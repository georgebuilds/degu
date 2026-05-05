export type AppMode = 'triage' | 'library' | 'tags'

type ModeRailProps = {
  mode: AppMode
  onModeChange: (next: AppMode) => void
  rootFolderName: string
}

const buttonBase =
  'flex h-9 w-9 items-center justify-center rounded-lg transition-colors'
const buttonInactive = 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100'
const buttonActive = 'bg-sky-500 text-zinc-950'

function railBtnClass(active: boolean): string {
  return `${buttonBase} ${active ? buttonActive : buttonInactive}`
}

export function ModeRail({ mode, onModeChange, rootFolderName }: ModeRailProps) {
  return (
    <aside class="flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-zinc-800 bg-zinc-900 py-4">
      <div
        class="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-sky-500 text-base font-bold text-zinc-950"
        aria-hidden
      >
        D
      </div>
      <button
        type="button"
        class={railBtnClass(mode === 'triage')}
        title="Triage  ·  one file at a time"
        aria-label="Triage — one file at a time"
        aria-current={mode === 'triage' ? 'page' : undefined}
        onClick={() => onModeChange('triage')}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
      </button>
      <button
        type="button"
        class={railBtnClass(mode === 'library')}
        title="Library  ·  browse files"
        aria-label="Library — browse files"
        aria-current={mode === 'library' ? 'page' : undefined}
        onClick={() => onModeChange('library')}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
      <button
        type="button"
        class={railBtnClass(mode === 'tags')}
        title="Tags  ·  manage your vocabulary"
        aria-label="Tags — manage your vocabulary"
        aria-current={mode === 'tags' ? 'page' : undefined}
        onClick={() => onModeChange('tags')}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <circle cx="7" cy="7" r="1.5" fill="currentColor" />
        </svg>
      </button>
      <div class="my-2 h-px w-6 bg-zinc-700" />
      <div class="flex-1" />
      <div
        class="text-[9px] tracking-wider text-zinc-500 [writing-mode:vertical-rl] [transform:rotate(180deg)]"
        title={rootFolderName}
      >
        {rootFolderName}
      </div>
    </aside>
  )
}

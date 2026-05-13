import { LibraryIcon, PeopleIcon, TagsIcon, TriageIcon } from './mode-icons.tsx'

export type AppMode = 'triage' | 'library' | 'tags' | 'people'

type ModeRailProps = {
  mode: AppMode
  onModeChange: (next: AppMode) => void
  rootFolderName: string
  onOpenSettings: () => void
}

const buttonBase =
  'flex h-9 w-9 items-center justify-center rounded-lg transition-colors'
const buttonInactive = 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100'
const buttonActive = 'bg-sky-500 text-zinc-950'

function railBtnClass(active: boolean): string {
  return `${buttonBase} ${active ? buttonActive : buttonInactive}`
}

export function ModeRail({
  mode,
  onModeChange,
  rootFolderName,
  onOpenSettings,
}: ModeRailProps) {
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
        <TriageIcon />
      </button>
      <button
        type="button"
        class={railBtnClass(mode === 'library')}
        title="Library  ·  browse files"
        aria-label="Library — browse files"
        aria-current={mode === 'library' ? 'page' : undefined}
        onClick={() => onModeChange('library')}
      >
        <LibraryIcon />
      </button>
      <button
        type="button"
        class={railBtnClass(mode === 'tags')}
        title="Tags  ·  manage your vocabulary"
        aria-label="Tags — manage your vocabulary"
        aria-current={mode === 'tags' ? 'page' : undefined}
        onClick={() => onModeChange('tags')}
      >
        <TagsIcon />
      </button>
      <button
        type="button"
        class={railBtnClass(mode === 'people')}
        title="People  ·  face tags"
        aria-label="People — face tags"
        aria-current={mode === 'people' ? 'page' : undefined}
        onClick={() => onModeChange('people')}
      >
        <PeopleIcon />
      </button>
      <div class="my-2 h-px w-6 bg-zinc-700" />
      <div class="flex-1" />
      <div
        class="text-[9px] tracking-wider text-zinc-500 [writing-mode:vertical-rl] [transform:rotate(180deg)]"
        title={rootFolderName}
      >
        {rootFolderName}
      </div>
      <button
        type="button"
        class="mt-2 flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        title="Settings"
        aria-label="Settings"
        onClick={onOpenSettings}
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
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </aside>
  )
}

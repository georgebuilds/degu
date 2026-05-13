import { useCallback, useRef, useState } from 'preact/hooks'
import {
  dismissIntro,
  isIntroDismissed,
  loadDefaultStartMode,
  saveDefaultStartMode,
} from '../lib/settings'
import { useFocusTrap } from '../lib/use-focus-trap'
import { LibraryIcon, PeopleIcon, TagsIcon, TriageIcon } from './mode-icons.tsx'
import type { AppMode } from './ModeRail.tsx'
import { useModalEscape } from './use-modal-stack.ts'

type SettingsModalProps = {
  onClose: () => void
}

const modeChoices = [
  {
    value: 'triage' as const,
    label: 'Triage',
    description: 'One at a time, decide what to keep.',
    Icon: TriageIcon,
  },
  {
    value: 'library' as const,
    label: 'Library',
    description: 'Browse the whole folder.',
    Icon: LibraryIcon,
  },
  {
    value: 'tags' as const,
    label: 'Tags',
    description: 'Manage your tag vocabulary.',
    Icon: TagsIcon,
  },
  {
    value: 'people' as const,
    label: 'People',
    description: 'Browse and tag faces.',
    Icon: PeopleIcon,
  },
]

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [defaultMode, setDefaultMode] = useState<AppMode>(() =>
    loadDefaultStartMode()
  )
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, true)
  useModalEscape(true, onClose)

  const select = useCallback((next: AppMode) => {
    setDefaultMode(next)
    saveDefaultStartMode(next)
    // Picking a value is unambiguous proof the user saw the setting.
    if (!isIntroDismissed()) dismissIntro()
  }, [])

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        class="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-700/80 bg-gradient-to-b from-zinc-950 to-zinc-950/95 shadow-2xl ring-1 ring-white/5"
      >
        <div class="flex items-start justify-between gap-3 border-b border-zinc-800/80 px-6 py-5">
          <h2
            id="settings-modal-title"
            class="text-xl font-semibold tracking-tight text-zinc-50"
          >
            Settings
          </h2>
          <button
            type="button"
            class="-mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close settings"
            onClick={onClose}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        </div>

        <div class="px-6 py-5">
          <h3 class="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Startup
          </h3>
          <p class="text-sm font-medium text-zinc-200">Default start screen</p>
          <p class="mt-0.5 text-xs text-zinc-500">
            Open this view when degu starts.
          </p>
          <div
            role="radiogroup"
            aria-label="Default start screen"
            class="mt-4 grid grid-cols-3 gap-2.5"
          >
            {modeChoices.map(choice => {
              const active = defaultMode === choice.value
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  class={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? 'border-sky-500/60 bg-sky-500/5'
                      : 'border-zinc-700/80 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900'
                  }`}
                  onClick={() => select(choice.value)}
                >
                  <span
                    class={`grid h-8 w-8 place-items-center rounded-lg ${
                      active
                        ? 'bg-sky-500 text-zinc-950'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    <choice.Icon size={16} />
                  </span>
                  <span
                    class={`text-sm font-medium ${
                      active ? 'text-zinc-50' : 'text-zinc-200'
                    }`}
                  >
                    {choice.label}
                  </span>
                  <span class="text-xs leading-snug text-zinc-500">
                    {choice.description}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

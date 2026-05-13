import { dismissIntro } from '../lib/settings'

type IntroRibbonProps = {
  onOpenSettings: () => void
}

export function IntroRibbon({ onOpenSettings }: IntroRibbonProps) {
  return (
    <div
      role="status"
      class="flex shrink-0 items-center gap-3 border-b border-zinc-800 border-l-2 border-l-sky-500/60 bg-zinc-900 py-2 pl-3 pr-2 text-xs text-zinc-300"
    >
      <span class="min-w-0 flex-1">
        degu opens in triage. You can change the default start screen in{' '}
        <button
          type="button"
          class="font-medium text-sky-400 underline-offset-2 hover:text-sky-300 hover:underline focus:underline focus:outline-none"
          onClick={onOpenSettings}
        >
          Settings
        </button>
        .
      </span>
      <button
        type="button"
        class="grid h-6 w-6 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        aria-label="Dismiss"
        onClick={() => dismissIntro()}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
        >
          <path d="M6 6l12 12M18 6l-12 12" />
        </svg>
      </button>
    </div>
  )
}

type ProgressBarProps = {
  /** 0–100 when not indeterminate */
  percent?: number
  /** When true, show an animated bar (unknown completion) */
  indeterminate?: boolean
  class?: string
}

export function ProgressBar({
  percent = 0,
  indeterminate = false,
  class: className = '',
}: ProgressBarProps) {
  if (indeterminate) {
    return (
      <div
        class={`h-1.5 w-full overflow-hidden rounded-full bg-zinc-800 ${className}`}
        role="progressbar"
        aria-valuetext="In progress"
      >
        <div
          class="h-full w-2/5 rounded-full bg-sky-600"
          style={{
            animation: 'progress-indeterminate 1.1s ease-in-out infinite',
          }}
        />
      </div>
    )
  }
  const p = Math.min(100, Math.max(0, percent))
  return (
    <div
      class={`h-1.5 w-full overflow-hidden rounded-full bg-zinc-800 ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        class="h-full rounded-full bg-sky-600 transition-[width] duration-150 ease-out"
        style={{ width: `${p}%` }}
      />
    </div>
  )
}

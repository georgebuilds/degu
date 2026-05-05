import type { ComponentChildren } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import {
  buildAggregateFromTagIndex,
  getStaleFiles,
  getTagCreatedAt,
} from '../lib/tags'
import { tagColor } from '../lib/tag-color'
import { useTagIndexVersion } from '../lib/use-tag-index-version'

type SortMode = 'alpha' | 'count' | 'newest' | 'oldest'

type TagsScreenProps = {
  rootFolderName: string
  onOpenStale: () => void
}

/**
 * Manage the tag vocabulary. Shows every tag with its file count, creation
 * date (when known), and a stale-files indicator that links into Triage.
 */
export function TagsScreen({ rootFolderName, onOpenStale }: TagsScreenProps) {
  const [sort, setSort] = useState<SortMode>('count')
  const tagIndexVersion = useTagIndexVersion()

  const rows = useMemo(() => {
    const { counts } = buildAggregateFromTagIndex()
    return counts.map(({ tag, count }) => ({
      tag,
      count,
      createdAt: getTagCreatedAt(tag),
    }))
  }, [tagIndexVersion])

  const sorted = useMemo(() => {
    const copy = [...rows]
    switch (sort) {
      case 'alpha':
        copy.sort((a, b) => a.tag.localeCompare(b.tag))
        break
      case 'count':
        copy.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
        break
      case 'newest':
        copy.sort((a, b) => {
          if (a.createdAt && b.createdAt) return b.createdAt.localeCompare(a.createdAt)
          if (a.createdAt) return -1
          if (b.createdAt) return 1
          return a.tag.localeCompare(b.tag)
        })
        break
      case 'oldest':
        copy.sort((a, b) => {
          if (a.createdAt && b.createdAt) return a.createdAt.localeCompare(b.createdAt)
          if (a.createdAt) return -1
          if (b.createdAt) return 1
          return a.tag.localeCompare(b.tag)
        })
        break
    }
    return copy
  }, [rows, sort])

  const staleCount = useMemo(() => getStaleFiles().length, [tagIndexVersion])

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-10 py-8">
      <header class="mb-7 flex items-end justify-between gap-4">
        <div>
          <div class="font-mono text-xs text-zinc-500">{rootFolderName}</div>
          <h1 class="mt-1 text-3xl font-semibold tracking-tight text-zinc-100">
            Tags
            <span class="ml-3 font-mono text-base font-normal text-zinc-500">
              {rows.length}
            </span>
          </h1>
        </div>
        <div class="inline-flex rounded-lg border border-zinc-700 bg-zinc-800 p-0.5 text-xs">
          <SortButton current={sort} value="count" onClick={setSort}>
            Most used
          </SortButton>
          <SortButton current={sort} value="alpha" onClick={setSort}>
            A–Z
          </SortButton>
          <SortButton current={sort} value="newest" onClick={setSort}>
            Newest
          </SortButton>
          <SortButton current={sort} value="oldest" onClick={setSort}>
            Oldest
          </SortButton>
        </div>
      </header>

      {staleCount > 0 ? (
        <button
          type="button"
          class="mb-6 flex items-start gap-4 rounded-xl border border-sky-900 bg-sky-900/40 p-4 text-left transition-colors hover:bg-sky-900/60"
          onClick={onOpenStale}
        >
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sky-500 text-zinc-950">
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
          </div>
          <div class="min-w-0">
            <div class="text-sm font-medium text-zinc-100">
              {staleCount.toLocaleString()} files may want a newer tag
            </div>
            <div class="mt-1 text-xs text-zinc-400">
              These files were last reviewed before tags they don't currently
              have were created. Open Triage to revisit them.
            </div>
          </div>
        </button>
      ) : null}

      {rows.length === 0 ? (
        <div class="flex flex-1 items-center justify-center text-sm text-zinc-500">
          No tags yet. Open the Triage screen to start.
        </div>
      ) : (
        <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(({ tag, count, createdAt }) => (
            <li
              key={tag}
              class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <span
                class="h-3 w-3 shrink-0 rounded-full"
                style={{ background: tagColor(tag) }}
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm text-zinc-100">{tag}</div>
                <div class="font-mono text-[11px] text-zinc-500">
                  {createdAt
                    ? `created ${formatRelativeDate(createdAt)}`
                    : 'created date unknown'}
                </div>
              </div>
              <span class="font-mono text-xs tabular-nums text-zinc-400">
                {count.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SortButton({
  current,
  value,
  onClick,
  children,
}: {
  current: SortMode
  value: SortMode
  onClick: (v: SortMode) => void
  children: ComponentChildren
}) {
  const active = current === value
  return (
    <button
      type="button"
      class={
        active
          ? 'rounded-md bg-zinc-700 px-2.5 py-1 text-zinc-100'
          : 'rounded-md px-2.5 py-1 text-zinc-400 hover:text-zinc-100'
      }
      aria-pressed={active}
      onClick={() => onClick(value)}
    >
      {children}
    </button>
  )
}

function formatRelativeDate(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'unknown'
  const diff = Date.now() - t
  const day = 86_400_000
  const days = Math.round(diff / day)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  const weeks = Math.round(days / 7)
  if (weeks < 8) return `${weeks} weeks ago`
  const months = Math.round(days / 30)
  if (months < 18) return `${months} months ago`
  const years = (days / 365).toFixed(1)
  return `${years} years ago`
}

import { useState } from 'preact/hooks'
import type { MediaKindFilter } from '../lib/supported-media'
import type { AggregateTagsProgress } from '../lib/root-tag-index'
import { ProgressBar } from './ProgressBar.tsx'
import { tagColor } from '../lib/tag-color'
import { checkForUpdate, applyUpdate, type CheckUpdateResponse } from '../lib/api-client'

export type TagCount = { tag: string; count: number }

type UpdateCheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'result'; resp: CheckUpdateResponse }
  | { kind: 'error'; msg: string }
  | { kind: 'installing' }
  | { kind: 'installed'; version: string }
  | { kind: 'install-error'; msg: string; releaseUrl?: string }

type SidebarProps = {
  collapsed: boolean
  onToggleCollapse: () => void
  searchQuery: string
  onSearchChange: (q: string) => void
  mediaKindFilter: MediaKindFilter
  onMediaKindFilterChange: (filter: MediaKindFilter) => void
  filterTags: string[]
  filterUntagged: boolean
  onToggleFilterUntagged: () => void
  /** When set, tags not in this set are disabled (no file matches current filter + that tag). */
  filterTagSelectableSet: Set<string> | null
  allTagsWithCounts: TagCount[]
  tagsLoading: boolean
  tagScanProgress: AggregateTagsProgress | null
  rootFolderName: string
  onToggleFilterTag: (tag: string) => void
  onClearFilters: () => void
  stack: FileSystemDirectoryHandle[]
  onBreadcrumb: (index: number) => void
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  searchQuery,
  onSearchChange,
  mediaKindFilter,
  onMediaKindFilterChange,
  filterTags,
  filterUntagged,
  onToggleFilterUntagged,
  filterTagSelectableSet,
  allTagsWithCounts,
  tagsLoading,
  tagScanProgress,
  rootFolderName,
  onToggleFilterTag,
  onClearFilters,
  stack,
  onBreadcrumb,
}: SidebarProps) {
  const [updateState, setUpdateState] = useState<UpdateCheckState>({ kind: 'idle' })

  async function onCheckClick() {
    setUpdateState({ kind: 'checking' })
    try {
      const resp = await checkForUpdate()
      if (resp.pendingRestart && resp.pendingVersion) {
        setUpdateState({ kind: 'installed', version: resp.pendingVersion })
      } else {
        setUpdateState({ kind: 'result', resp })
      }
    } catch (e) {
      setUpdateState({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'check failed',
      })
    }
  }

  async function onInstallClick(releaseUrl?: string) {
    setUpdateState({ kind: 'installing' })
    try {
      const resp = await applyUpdate()
      if (resp.success && resp.newVersion) {
        setUpdateState({ kind: 'installed', version: resp.newVersion })
      } else {
        setUpdateState({ kind: 'install-error', msg: resp.error || 'unknown error', releaseUrl })
      }
    } catch (e) {
      setUpdateState({
        kind: 'install-error',
        msg: e instanceof Error ? e.message : 'install failed',
        releaseUrl,
      })
    }
  }

  return (
    <aside
      class={
        collapsed
          ? 'flex min-h-0 w-14 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/80 transition-[width] duration-200 ease-out'
          : 'flex min-h-0 w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/80 transition-[width] duration-200 ease-out'
      }
    >
      <div class="flex h-12 shrink-0 items-center border-b border-zinc-800 px-2">
        <button
          type="button"
          class="flex h-9 w-full items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          <span class="text-lg" aria-hidden>
            {collapsed ? '›' : '‹'}
          </span>
          {collapsed ? null : (
            <span class="ml-2 flex-1 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
              Menu
            </span>
          )}
        </button>
      </div>

      {collapsed ? null : (
        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
          <nav class="flex flex-col gap-1" aria-label="Main menu">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Navigation
            </span>
     
            <div class="flex flex-col gap-0.5 pl-1 text-xs text-zinc-500">
              {stack.map((h, i) => (
                <button
                  key={`${h.name}-${i}`}
                  type="button"
                  class={
                    i === stack.length - 1
                      ? 'truncate text-left font-medium text-zinc-300'
                      : 'truncate text-left text-sky-400 hover:underline'
                  }
                  onClick={() => onBreadcrumb(i)}
                >
                  {i === 0 ? h.name : `↳ ${h.name}`}
                </button>
              ))}
            </div>
          </nav>

          <div>
            <label
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
              for="sidebar-search"
            >
              Search
            </label>
            <input
              id="sidebar-search"
              type="search"
              placeholder="Search"
              value={searchQuery}
              onInput={e =>
                onSearchChange((e.target as HTMLInputElement).value)
              }
              class="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
            />
          </div>

          <div>
            <span
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
              id="sidebar-media-filter-label"
            >
              Show in browser
            </span>
            <div
              class="flex rounded-lg border border-zinc-700 p-0.5"
              role="group"
              aria-labelledby="sidebar-media-filter-label"
            >
              <button
                type="button"
                class={
                  mediaKindFilter === 'images'
                    ? 'flex-1 rounded-md bg-sky-600 px-2 py-2 text-center text-[11px] font-medium text-white'
                    : 'flex-1 rounded-md px-2 py-2 text-center text-[11px] font-medium text-zinc-400 hover:text-zinc-200'
                }
                aria-pressed={mediaKindFilter === 'images'}
                onClick={() => onMediaKindFilterChange('images')}
              >
                Images
              </button>
              <button
                type="button"
                class={
                  mediaKindFilter === 'both'
                    ? 'flex-1 rounded-md bg-sky-600 px-2 py-2 text-center text-[11px] font-medium text-white'
                    : 'flex-1 rounded-md px-2 py-2 text-center text-[11px] font-medium text-zinc-400 hover:text-zinc-200'
                }
                aria-pressed={mediaKindFilter === 'both'}
                onClick={() => onMediaKindFilterChange('both')}
              >
                Both
              </button>
              <button
                type="button"
                class={
                  mediaKindFilter === 'videos'
                    ? 'flex-1 rounded-md bg-sky-600 px-2 py-2 text-center text-[11px] font-medium text-white'
                    : 'flex-1 rounded-md px-2 py-2 text-center text-[11px] font-medium text-zinc-400 hover:text-zinc-200'
                }
                aria-pressed={mediaKindFilter === 'videos'}
                onClick={() => onMediaKindFilterChange('videos')}
              >
                Videos
              </button>
            </div>
            <p class="mt-1.5 text-[11px] leading-snug text-zinc-600">
              Filters the file list in the main area (folders are always shown).
            </p>
          </div>

          <div>
            <div class="mb-2 flex items-center justify-between gap-2">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                All tags
              </span>
              {filterTags.length > 0 || filterUntagged ? (
                <button
                  type="button"
                  class="text-[11px] text-sky-400 hover:underline"
                  onClick={onClearFilters}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
            <p class="mb-2 text-[11px] leading-snug text-zinc-600">
              Every tag used on any file under “{rootFolderName}” (all
              subfolders included).
            </p>
            <ul
              class="mb-2 flex flex-col gap-1.5"
              aria-label="Untagged filter"
            >
              <li class="flex items-center gap-2">
                <button
                  type="button"
                  class={
                    filterUntagged
                      ? 'min-w-0 flex-1 rounded-md bg-sky-600 px-2 py-1.5 text-left text-[11px] font-medium text-white'
                      : 'min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:border-zinc-500'
                  }
                  aria-pressed={filterUntagged}
                  onClick={onToggleFilterUntagged}
                >
                  <span class="block truncate">Untagged</span>
                </button>
              </li>
            </ul>
            {tagsLoading ? (
              <div class="flex flex-col gap-2" aria-live="polite">
                <p class="text-xs text-zinc-500">
                  Scanning folder tree for tags…
                </p>
                {tagScanProgress ? (
                  <>
                    {tagScanProgress.phase === 'tags' ? (
                      <ProgressBar
                        percent={
                          tagScanProgress.total > 0
                            ? (tagScanProgress.done / tagScanProgress.total) *
                              100
                            : 0
                        }
                      />
                    ) : (
                      <ProgressBar indeterminate />
                    )}
                    <p class="text-[10px] tabular-nums text-zinc-600">
                      {tagScanProgress.phase === 'collect' ? (
                        <>
                          {tagScanProgress.dirsVisited.toLocaleString()} folders
                          · {tagScanProgress.mediaFiles.toLocaleString()} media
                          files found
                        </>
                      ) : (
                        <>
                          Reading tags{' '}
                          {tagScanProgress.done.toLocaleString()} /{' '}
                          {tagScanProgress.total.toLocaleString()}
                        </>
                      )}
                    </p>
                  </>
                ) : null}
              </div>
            ) : allTagsWithCounts.length === 0 ? (
              <p class="text-xs text-zinc-600">
                No named tags yet. Right-click a file and choose Edit tags to
                add some.
              </p>
            ) : (
              <ul class="flex flex-col gap-1.5" aria-label="All tags under root folder">
                {allTagsWithCounts.map(({ tag, count }) => {
                  const on = filterTags.includes(tag)
                  const disabled =
                    filterTagSelectableSet !== null &&
                    !filterTagSelectableSet.has(tag)
                  return (
                    <li key={tag} class="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={disabled}
                        class={
                          on
                            ? 'min-w-0 flex-1 rounded-md bg-sky-600 px-2 py-1.5 text-left text-[11px] font-medium text-white'
                            : disabled
                              ? 'min-w-0 flex-1 cursor-not-allowed rounded-md border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-left text-[11px] text-zinc-600'
                              : 'min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:border-zinc-500'
                        }
                        title={
                          disabled
                            ? 'No files have this tag together with your current filter'
                            : 'Toggle filter'
                        }
                        onClick={() => onToggleFilterTag(tag)}
                      >
                        <span class="flex min-w-0 items-center gap-1.5">
                          <span
                            class="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: tagColor(tag) }}
                          />
                          <span class="block truncate">{tag}</span>
                        </span>
                      </button>
                      <span
                        class={
                          disabled
                            ? 'shrink-0 tabular-nums text-[11px] text-zinc-700'
                            : 'shrink-0 tabular-nums text-[11px] text-zinc-500'
                        }
                      >
                        {count}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            <p class="mt-2 text-[11px] leading-snug text-zinc-600">
              Selected tags switch the main view to all files under your connected
              folder that have every selected tag. Tags that cannot narrow further
              (none of those files also have that tag) appear disabled. Clear tags
              to return to normal browsing or search.
            </p>
          </div>
        </div>
      )}

      {collapsed ? null : (
        <div class="shrink-0 border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-500">
          <UpdateFooter state={updateState} onCheck={onCheckClick} onInstall={onInstallClick} />
        </div>
      )}
    </aside>
  )
}

function UpdateFooter({
  state,
  onCheck,
  onInstall,
}: {
  state: UpdateCheckState
  onCheck: () => void
  onInstall: (releaseUrl?: string) => void
}) {
  if (state.kind === 'checking') {
    return <span class="text-zinc-500">Checking for updates…</span>
  }
  if (state.kind === 'installing') {
    return <span class="text-sky-300">Installing update…</span>
  }
  if (state.kind === 'installed') {
    return (
      <span class="truncate text-emerald-400" title={`v${state.version} installed`}>
        Updated to v{state.version} — restart degu
      </span>
    )
  }
  if (state.kind === 'install-error') {
    return (
      <div class="flex items-center justify-between gap-2">
        <span class="truncate text-amber-400/80" title={state.msg}>
          Install failed
        </span>
        <div class="flex shrink-0 gap-1">
          {state.releaseUrl ? (
            <a
              class="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-zinc-500"
              href={state.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Download manually"
            >
              ↓
            </a>
          ) : null}
          <button
            type="button"
            class="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-zinc-500"
            onClick={onCheck}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div class="flex items-center justify-between gap-2">
        <span class="truncate text-amber-400/80" title={state.msg}>
          Couldn't check for updates
        </span>
        <button
          type="button"
          class="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-zinc-500"
          onClick={onCheck}
        >
          Retry
        </button>
      </div>
    )
  }
  if (state.kind === 'result') {
    const { resp } = state
    if (resp.error) {
      return (
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-amber-400/80" title={resp.error}>
            Couldn't check for updates
          </span>
          <button
            type="button"
            class="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-zinc-500"
            onClick={onCheck}
          >
            Retry
          </button>
        </div>
      )
    }
    if (resp.updateAvailable && resp.latest) {
      const href = resp.assetUrl || resp.releaseUrl
      if (resp.canSelfUpdate) {
        return (
          <div class="flex items-center justify-between gap-2">
            <span class="truncate text-sky-300" title={`v${resp.current} → v${resp.latest}`}>
              v{resp.latest} available
            </span>
            <div class="flex shrink-0 gap-1">
              {href ? (
                <a
                  class="rounded border border-zinc-700 px-2 py-0.5 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Download manually"
                >
                  ↓
                </a>
              ) : null}
              <button
                type="button"
                class="rounded border border-sky-500/60 bg-sky-600/20 px-2 py-0.5 text-sky-200 hover:bg-sky-600/30"
                onClick={() => onInstall(resp.releaseUrl)}
              >
                Install
              </button>
            </div>
          </div>
        )
      }
      return (
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-sky-300" title={`v${resp.current} → v${resp.latest}`}>
            v{resp.latest} available
          </span>
          {href ? (
            <a
              class="rounded border border-sky-500/60 bg-sky-600/20 px-2 py-0.5 text-sky-200 hover:bg-sky-600/30"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              Download
            </a>
          ) : null}
        </div>
      )
    }
    return (
      <div class="flex items-center justify-between gap-2">
        <span class="truncate text-zinc-500">Up to date{resp.current ? ` (v${resp.current})` : ''}</span>
        <button
          type="button"
          class="rounded border border-zinc-800 px-2 py-0.5 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
          onClick={onCheck}
          title="Check again"
        >
          ↻
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      class="w-full rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-zinc-300 hover:border-zinc-500"
      onClick={onCheck}
    >
      Check for updates
    </button>
  )
}

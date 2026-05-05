import type { MediaKindFilter } from '../lib/supported-media'
import type { AggregateTagsProgress } from '../lib/root-tag-index'
import { ProgressBar } from './ProgressBar.tsx'
import { tagColor } from '../lib/tag-color'

export type TagCount = { tag: string; count: number }

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
  onReload: () => void
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
  // onReload,
}: SidebarProps) {
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
            {/* <button
              type="button"
              class="rounded-md px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
              onClick={onReload}
            >
              Reload page
            </button> */}
    
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
              <div class="flex flex-col gap-2">
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
    </aside>
  )
}

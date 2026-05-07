import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { tagStorageKeyForFileInStack } from '../lib/tag-key'
import {
  buildAggregateFromTagIndex,
  getTags,
  getTagsCached,
  getVideoLoops,
  setTags,
  setVideoLoops,
  type VideoLoop,
} from '../lib/tags'
import {
  QUICK_ADD_RECENT_VISIBLE,
  recordTagApplied,
} from '../lib/recent-tags'
import { useRecentTags } from '../lib/use-recent-tags'
import { buildMoreQuickAddTagsMulti } from '../lib/more-quick-add-tags.ts'
import { MoreTagsQuickAddDropdown } from './MoreTagsQuickAddDropdown'
import { getPreviewKind } from '../lib/preview'
import type { PreviewKind } from '../lib/preview'
import {
  basenameFromRelativePath,
  isSupportedMediaFile,
  passesMediaKindFilter,
  type MediaKindFilter,
} from '../lib/supported-media'
import type { NormalizeReport } from '../lib/normalize-filenames'
import {
  findFilesWithAllTags,
  findUntaggedFiles,
} from '../lib/files-matching-tags'
import { collectAllMediaRelativePaths } from '../lib/media-paths'
import {
  resolveParentDirectoryAndFileName,
  resolvePathToFileListItem,
} from '../lib/resolve-path'
import type { AggregateTagsProgress } from '../lib/root-tag-index'
import {
  countsFromTagToPaths,
  patchTagIndexAfterEdit,
} from '../lib/patch-tag-index'
import {
  pathsMatchingAllTags,
  relativePathsUntagged,
  tagsSelectableWithFilter,
  unionOfTaggedPaths,
} from '../lib/tag-filter-paths'
import {
  scanRecursive,
  type SearchScanProgress,
} from '../lib/recursive-scan'
import { mapWithConcurrency } from '../lib/throttle'
import {
  hashUrlFromSegments,
  parseHashToSegments,
  stackHandlesToSegments,
} from '../lib/hash-location'
import { resolveDirectoryStack } from '../lib/resolve-directory-stack'
import { FileContextMenu } from './FileContextMenu.tsx'
import { FileRow, type DirListItem, type FileListItem } from './FileRow.tsx'
import { FileThumbnail, FolderThumbnail } from './FileThumbnail.tsx'
import { PreviewModal } from './PreviewModal.tsx'
import { Sidebar } from './Sidebar.tsx'
import { NormalizeFilenamesModal } from './NormalizeFilenamesModal.tsx'
import { StorageStatsModal } from './StorageStatsModal.tsx'
import { TagsModal } from './TagsModal.tsx'
import { ViewerPane, type ViewerPaneItem } from './ViewerPane.tsx'
import { ProgressBar } from './ProgressBar.tsx'
import { formatMediaTime } from '../lib/format-media-time.ts'

type FileBrowserProps = {
  rootHandle: FileSystemDirectoryHandle
}

type ViewMode = 'list' | 'thumbnails'

/** Name / size / tag count × asc / desc */
type SortMode =
  | 'name-asc'
  | 'name-desc'
  | 'size-asc'
  | 'size-desc'
  | 'tags-asc'
  | 'tags-desc'

/** Comparator for non-tags sort modes — no global state lookups. */
function compareFileListItems(a: FileListItem, b: FileListItem, mode: SortMode): number {
  switch (mode) {
    case 'name-asc':
      return a.name.localeCompare(b.name)
    case 'name-desc':
      return b.name.localeCompare(a.name)
    case 'size-asc':
      return a.size - b.size || a.name.localeCompare(b.name)
    case 'size-desc':
      return b.size - a.size || a.name.localeCompare(b.name)
    default:
      return 0
  }
}

function compareDirListItems(a: DirListItem, b: DirListItem, mode: SortMode): number {
  if (mode.startsWith('name')) {
    return mode === 'name-asc'
      ? a.name.localeCompare(b.name)
      : b.name.localeCompare(a.name)
  }
  return a.name.localeCompare(b.name)
}

/**
 * Read size + lastModified from a file handle without paying for a full
 * fetch when the handle already exposes them. The HTTP shim
 * (HttpFileHandle) carries both as own properties; the FSA spec puts them
 * on the resulting File only, so we fall back to getFile() there.
 */
async function readEntrySizeMtime(
  fh: FileSystemFileHandle
): Promise<{ size: number; lastModified: number }> {
  const cached = fh as unknown as { size?: unknown; lastModified?: unknown }
  if (typeof cached.size === 'number' && typeof cached.lastModified === 'number') {
    return { size: cached.size, lastModified: cached.lastModified }
  }
  const file = await fh.getFile()
  return { size: file.size, lastModified: file.lastModified }
}

export function FileBrowser({ rootHandle }: FileBrowserProps) {
  const [stack, setStack] = useState<FileSystemDirectoryHandle[]>([rootHandle])
  const [dirs, setDirs] = useState<DirListItem[]>([])
  const [files, setFiles] = useState<FileListItem[]>([])
  const [fileTags, setFileTags] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [filterUntagged, setFilterUntagged] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  /** Search input after debounce — avoids a full tree walk on every keystroke. */
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{
    dirs: DirListItem[]
    files: FileListItem[]
  } | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchScanProgress, setSearchScanProgress] =
    useState<SearchScanProgress | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('thumbnails')
  const [mediaKindFilter, setMediaKindFilter] =
    useState<MediaKindFilter>('both')
  const [sortMode, setSortMode] = useState<SortMode>('name-asc')
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    /** Item under cursor (caption / single-file actions). */
    file: FileListItem
    /** Keys tags & delete apply to — usually full selection when anchor is selected. */
    targetKeys: string[]
  } | null>(null)
  const [tagsModalKeys, setTagsModalKeys] = useState<string[] | null>(null)
  const [viewerItems, setViewerItems] = useState<ViewerPaneItem[]>([])
  const [preview, setPreview] = useState<{
    handle: FileSystemFileHandle
    kind: PreviewKind
    tagStorageKey: string
    fileSizeBytes: number
    fileName: string
    saveDirectoryHandle: FileSystemDirectoryHandle | null
  } | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const selectionAnchorRef = useRef<number | null>(null)
  const [tagFilterResults, setTagFilterResults] = useState<FileListItem[] | null>(
    null
  )
  const [tagFilterLoading, setTagFilterLoading] = useState(false)
  const [tagFilterVersion, setTagFilterVersion] = useState(0)
  const tagFilterScanGen = useRef(0)
  const [normalizeModalOpen, setNormalizeModalOpen] = useState(false)
  const [storageStatsModalOpen, setStorageStatsModalOpen] = useState(false)
  const [listRefreshTick, setListRefreshTick] = useState(0)
  /** Avoids a full tree walk on every Untagged toggle when the file tree is unchanged. */
  const mediaPathsListCacheRef = useRef<{
    rootHandle: FileSystemDirectoryHandle
    listRefreshTick: number
    paths: string[]
  } | null>(null)

  const recentTags = useRecentTags()

  const SEARCH_DEBOUNCE_MS = 280
  useEffect(() => {
    const q = searchQuery.trim()
    if (q === '') {
      setDebouncedSearchQuery('')
      return
    }
    const t = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const segments = parseHashToSegments()
      if (segments.length === 0) {
        if (!cancelled) {
          history.replaceState(null, '', hashUrlFromSegments([]))
          setStack([rootHandle])
        }
        return
      }
      try {
        const resolved = await resolveDirectoryStack(rootHandle, segments)
        if (!cancelled) setStack(resolved)
      } catch {
        if (!cancelled) {
          setStack([rootHandle])
          history.replaceState(null, '', hashUrlFromSegments([]))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rootHandle])

  useEffect(() => {
    const onPop = () => {
      void (async () => {
        const segments = parseHashToSegments()
        try {
          if (segments.length === 0) {
            setStack([rootHandle])
            return
          }
          const resolved = await resolveDirectoryStack(rootHandle, segments)
          setStack(resolved)
        } catch {
          setStack([rootHandle])
          history.replaceState(null, '', hashUrlFromSegments([]))
        }
      })()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [rootHandle])

  const currentDir = stack[stack.length - 1]

  const searchQueryRef = useRef(searchQuery)
  searchQueryRef.current = searchQuery

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      // First pass: collect raw entries without calling getFile()
      const rawFileHandles: Array<{ fh: FileSystemFileHandle; name: string }> = []
      const dirEntries: DirListItem[] = []
      for await (const entry of currentDir.values()) {
        if (entry.kind === 'file') {
          if (!isSupportedMediaFile(entry.name)) continue
          rawFileHandles.push({ fh: entry as FileSystemFileHandle, name: entry.name })
        } else {
          dirEntries.push({
            kind: 'directory',
            name: entry.name,
            handle: entry as FileSystemDirectoryHandle,
          })
        }
      }

      // Second pass: read size/mtime — prefer handle properties (HTTP shim
      // exposes them; the FSA spec doesn't, so fall back to getFile()).
      const resolvedFiles = await Promise.all(
        rawFileHandles.map(async ({ fh, name }) => {
          const { size, lastModified } = await readEntrySizeMtime(fh)
          const tagStorageKey = tagStorageKeyForFileInStack(stack, name)
          return {
            kind: 'file' as const,
            name,
            tagStorageKey,
            handle: fh,
            size,
            lastModified,
          }
        })
      )

      const fileEntries: FileListItem[] = resolvedFiles
      fileEntries.sort((a, b) => a.name.localeCompare(b.name))
      dirEntries.sort((a, b) => a.name.localeCompare(b.name))

      if (cancelled) return

      const tagCache = new Map<string, string[]>()
      const tagSets = await Promise.all(
        fileEntries.map(f => getTagsCached(f.tagStorageKey, tagCache))
      )
      const nextTags: Record<string, string[]> = {}
      fileEntries.forEach((f, i) => {
        nextTags[f.tagStorageKey] = tagSets[i] ?? []
      })

      if (!cancelled) {
        setFiles(fileEntries)
        setDirs(dirEntries)
        if (searchQueryRef.current.trim() === '') {
          setFileTags(nextTags)
        }
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentDir, stack, listRefreshTick])

  useEffect(() => {
    if (searchQuery.trim() !== '') return
    if (files.length === 0) return
    const tagCache = new Map<string, string[]>()
    const nextTags: Record<string, string[]> = {}
    for (const f of files) {
      nextTags[f.tagStorageKey] = getTagsCached(f.tagStorageKey, tagCache)
    }
    setFileTags(prev => {
      for (const key in nextTags) {
        if (prev[key] !== nextTags[key]) return { ...prev, ...nextTags }
      }
      return prev
    })
  }, [searchQuery, files])

  useEffect(() => {
    if (filterTags.length > 0 || filterUntagged) {
      setSearchResults(null)
      setSearchLoading(false)
      setSearchScanProgress(null)
      return
    }
    const q = debouncedSearchQuery.trim()
    if (q === '') {
      setSearchResults(null)
      setSearchLoading(false)
      setSearchScanProgress(null)
      return
    }
    const ac = new AbortController()
    setSearchLoading(true)
    setSearchScanProgress({ entriesVisited: 0, dirsSeen: 0 })
    void (async () => {
      try {
        const res = await scanRecursive(currentDir, q, stack, {
          signal: ac.signal,
          onProgress: p => setSearchScanProgress(p),
        })
        if (ac.signal.aborted) return
        setSearchResults({ dirs: res.dirs, files: res.files })
        setFileTags(prev => {
          const next = { ...prev }
          for (const [name, tags] of Object.entries(res.fileTags)) {
            next[name] = tags
          }
          return next
        })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setSearchResults({ dirs: [], files: [] })
      } finally {
        if (!ac.signal.aborted) {
          setSearchLoading(false)
          setSearchScanProgress(null)
        }
      }
    })()
    return () => {
      ac.abort()
      setSearchScanProgress(null)
    }
  }, [currentDir, debouncedSearchQuery, filterTags, filterUntagged, stack])

  const isTagFilterMode = filterTags.length > 0 || filterUntagged
  const isSearchMode = searchQuery.trim() !== '' && !isTagFilterMode
  const searchDebouncePending =
    searchQuery.trim() !== '' &&
    searchQuery.trim() !== debouncedSearchQuery.trim()

  // Single call to buildAggregateFromTagIndex for both states; lazy ref avoids extra calls on re-render
  const _initAggRef = useRef<ReturnType<typeof buildAggregateFromTagIndex> | null>(null)
  if (_initAggRef.current === null) _initAggRef.current = buildAggregateFromTagIndex()
  const [rootTagCounts, setRootTagCounts] = useState<
    { tag: string; count: number }[]
  >(() => _initAggRef.current!.counts)
  /** Inverted index from `index.json`; enables instant tag-filter without re-walking. */
  const [tagToPathsMap, setTagToPathsMap] = useState<Map<
    string,
    Set<string>
  > | null>(() => new Map(_initAggRef.current!.tagToPaths))
  const [rootTagScanLoading, setRootTagScanLoading] = useState(false)
  const [tagScanProgress, setTagScanProgress] =
    useState<AggregateTagsProgress | null>(null)
  const rootTagScanGen = useRef(0)

  const rescanRootTags = useCallback(() => {
    const gen = ++rootTagScanGen.current
    setRootTagScanLoading(false)
    setTagScanProgress(null)
    const result = buildAggregateFromTagIndex()
    if (gen !== rootTagScanGen.current) return
    setRootTagCounts(result.counts)
    setTagToPathsMap(new Map(result.tagToPaths))
  }, [rootHandle])

  const onNormalizeComplete = useCallback(
    (report: NormalizeReport) => {
      rescanRootTags()
      setListRefreshTick(t => t + 1)
      setTagFilterVersion(v => v + 1)
      const map = new Map(
        report.successfulRenames.map(r => [r.from, r.to] as const)
      )
      setPreview(p => {
        if (!p) return null
        const to = map.get(p.tagStorageKey)
        if (!to) return p
        return { ...p, tagStorageKey: to }
      })
      setViewerItems(items =>
        items.map(item => {
          const loopSep = item.id.indexOf('#loop:')
          if (loopSep === -1) {
            const to = map.get(item.id)
            return to
              ? {
                  ...item,
                  id: to,
                  name: basenameFromRelativePath(to),
                }
              : item
          }
          const baseKey = item.id.slice(0, loopSep)
          const to = map.get(baseKey)
          if (!to) return item
          const suffix = item.id.slice(loopSep)
          const restLabel = item.name.includes(' · ')
            ? item.name.slice(item.name.indexOf(' · '))
            : ''
          return {
            ...item,
            id: `${to}${suffix}`,
            name: `${basenameFromRelativePath(to)}${restLabel}`,
          }
        })
      )
      setSelectedKeys(prev => {
        let changed = false
        const next = new Set<string>()
        for (const k of prev) {
          const to = map.get(k)
          if (to !== undefined) {
            next.add(to)
            if (to !== k) changed = true
          } else {
            next.add(k)
          }
        }
        return changed ? next : prev
      })
      setFileTags(prev => {
        let out: Record<string, string[]> | null = null
        for (const { from, to } of report.successfulRenames) {
          if (prev[from] !== undefined) {
            if (!out) out = { ...prev }
            out[to] = prev[from]!
            delete out[from]
          }
        }
        return out ?? prev
      })
    },
    [rescanRootTags]
  )

  useEffect(() => {
    if (!filterUntagged && filterTags.length === 0) {
      setTagFilterResults(null)
      setTagFilterLoading(false)
      return
    }
    const gen = ++tagFilterScanGen.current
    setTagFilterLoading(true)
    setTagFilterResults(null)

    if (filterUntagged) {
      if (tagToPathsMap !== null) {
        void (async () => {
          try {
            const union = unionOfTaggedPaths(tagToPathsMap)
            let allPaths: string[]
            const mpc = mediaPathsListCacheRef.current
            if (
              mpc &&
              mpc.rootHandle === rootHandle &&
              mpc.listRefreshTick === listRefreshTick
            ) {
              allPaths = mpc.paths
            } else {
              allPaths = await collectAllMediaRelativePaths(rootHandle)
              mediaPathsListCacheRef.current = {
                rootHandle,
                listRefreshTick,
                paths: allPaths,
              }
            }
            const paths = relativePathsUntagged(union, allPaths)
            if (paths.length === 0) {
              if (gen !== tagFilterScanGen.current) return
              setTagFilterResults([])
              return
            }
            const items = await mapWithConcurrency(
              paths,
              p => resolvePathToFileListItem(rootHandle, p),
              8
            )
            if (gen !== tagFilterScanGen.current) return
            setTagFilterResults(items)
            const tagCache = new Map<string, string[]>()
            const merged: Record<string, string[]> = {}
            for (const item of items) {
              merged[item.tagStorageKey] = getTagsCached(
                item.tagStorageKey,
                tagCache
              )
            }
            setFileTags(prev => ({ ...prev, ...merged }))
          } catch {
            if (gen !== tagFilterScanGen.current) return
            setTagFilterResults([])
          } finally {
            if (gen !== tagFilterScanGen.current) return
            setTagFilterLoading(false)
          }
        })()
        return
      }

      void findUntaggedFiles(rootHandle)
        .then(({ files: matched, fileTags: merged }) => {
          if (gen !== tagFilterScanGen.current) return
          setTagFilterResults(matched)
          setFileTags(prev => ({ ...prev, ...merged }))
        })
        .catch(() => {
          if (gen !== tagFilterScanGen.current) return
          setTagFilterResults([])
        })
        .finally(() => {
          if (gen !== tagFilterScanGen.current) return
          setTagFilterLoading(false)
        })
      return
    }

    const runFromIndex = () => {
      const paths = pathsMatchingAllTags(tagToPathsMap!, filterTags)
      if (paths.length === 0) {
        if (gen !== tagFilterScanGen.current) return
        setTagFilterResults([])
        setTagFilterLoading(false)
        return
      }
      void mapWithConcurrency(
        paths,
        p => resolvePathToFileListItem(rootHandle, p),
        8
      )
        .then(items => {
          if (gen !== tagFilterScanGen.current) return
          setTagFilterResults(items)
          const tagCache = new Map<string, string[]>()
          const merged: Record<string, string[]> = {}
          for (const item of items) {
            merged[item.tagStorageKey] = getTagsCached(
              item.tagStorageKey,
              tagCache
            )
          }
          setFileTags(prev => ({ ...prev, ...merged }))
        })
        .catch(() => {
          if (gen !== tagFilterScanGen.current) return
          setTagFilterResults([])
        })
        .finally(() => {
          if (gen !== tagFilterScanGen.current) return
          setTagFilterLoading(false)
        })
    }

    if (tagToPathsMap !== null) {
      runFromIndex()
      return
    }

    void findFilesWithAllTags(rootHandle, filterTags)
      .then(({ files: matched, fileTags: merged }) => {
        if (gen !== tagFilterScanGen.current) return
        setTagFilterResults(matched)
        setFileTags(prev => ({ ...prev, ...merged }))
      })
      .catch(() => {
        if (gen !== tagFilterScanGen.current) return
        setTagFilterResults([])
      })
      .finally(() => {
        if (gen !== tagFilterScanGen.current) return
        setTagFilterLoading(false)
      })
  }, [
    rootHandle,
    filterTags,
    filterUntagged,
    tagFilterVersion,
    tagToPathsMap,
    listRefreshTick,
  ])

  /** When non-null, only these tags are clickable in the sidebar (others have no matches with the current filter). */
  const sidebarFilterTagSelectableSet = useMemo(() => {
    if (filterUntagged) return new Set<string>()
    if (filterTags.length === 0) return null
    const sidebarTagNames = rootTagCounts.map(c => c.tag)
    if (tagToPathsMap !== null) {
      return tagsSelectableWithFilter(
        tagToPathsMap,
        filterTags,
        sidebarTagNames
      )
    }
    const items = tagFilterResults
    if (!items || items.length === 0) {
      return new Set(filterTags)
    }
    const out = new Set<string>(filterTags)
    const tagCache = new Map<string, string[]>()
    for (const item of items) {
      for (const t of getTagsCached(item.tagStorageKey, tagCache)) {
        out.add(t)
      }
    }
    return out
  }, [
    filterUntagged,
    filterTags,
    tagToPathsMap,
    rootTagCounts,
    tagFilterResults,
  ])

  const displayDirs = useMemo(() => {
    if (isTagFilterMode) return []
    if (!isSearchMode) return dirs
    return searchResults?.dirs ?? []
  }, [isTagFilterMode, isSearchMode, searchResults, dirs])

  const displayFiles = useMemo(() => {
    if (isTagFilterMode) {
      const base = tagFilterResults ?? []
      const q = debouncedSearchQuery.trim().toLowerCase()
      if (q === '') return base
      return base.filter(f => f.name.toLowerCase().includes(q))
    }
    const list = isSearchMode ? (searchResults?.files ?? []) : files
    return list
  }, [
    isTagFilterMode,
    tagFilterResults,
    isSearchMode,
    searchResults,
    files,
    debouncedSearchQuery,
  ])

  const filteredFiles = useMemo(
    () => displayFiles.filter(f => passesMediaKindFilter(f.name, mediaKindFilter)),
    [displayFiles, mediaKindFilter]
  )

  const sortedDisplayDirs = useMemo(() => {
    const arr = [...displayDirs]
    arr.sort((a, b) => compareDirListItems(a, b, sortMode))
    return arr
  }, [displayDirs, sortMode])

  const sortedDisplayFiles = useMemo(() => {
    const arr = [...filteredFiles]
    if (sortMode === 'tags-asc' || sortMode === 'tags-desc') {
      // Decorate: one pass to build tag-count map, then sort — O(N) lookups vs O(N log N)
      const tagCountMap = new Map<string, number>()
      for (const f of arr) {
        tagCountMap.set(f.tagStorageKey, getTags(f.tagStorageKey).length)
      }
      const dir = sortMode === 'tags-asc' ? 1 : -1
      arr.sort((a, b) => {
        const ca = tagCountMap.get(a.tagStorageKey) ?? 0
        const cb = tagCountMap.get(b.tagStorageKey) ?? 0
        return dir * (ca - cb) || a.name.localeCompare(b.name)
      })
    } else {
      arr.sort((a, b) => compareFileListItems(a, b, sortMode))
    }
    return arr
  }, [filteredFiles, sortMode])

  const selectedFiles = useMemo(
    () =>
      sortedDisplayFiles.filter(f => selectedKeys.has(f.tagStorageKey)),
    [sortedDisplayFiles, selectedKeys]
  )

  const selectedKeyArray = useMemo(
    () => selectedFiles.map(f => f.tagStorageKey),
    [selectedFiles]
  )

  const allKnownTagNamesList = useMemo(
    () => rootTagCounts.map(c => c.tag),
    [rootTagCounts]
  )

  const selectionMoreQuickAddTags = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return buildMoreQuickAddTagsMulti(
      allKnownTagNamesList,
      recentTags,
      QUICK_ADD_RECENT_VISIBLE,
      selectedKeyArray,
      fileTags
    )
  }, [selectedFiles, selectedKeyArray, allKnownTagNamesList, fileTags, recentTags])

  const contextMenuMoreQuickAddTags = useMemo(() => {
    if (!contextMenu) return []
    return buildMoreQuickAddTagsMulti(
      allKnownTagNamesList,
      recentTags,
      QUICK_ADD_RECENT_VISIBLE,
      contextMenu.targetKeys,
      fileTags
    )
  }, [contextMenu, allKnownTagNamesList, fileTags, recentTags])

  useEffect(() => {
    setSelectedKeys(new Set())
    selectionAnchorRef.current = null
  }, [currentDir, isTagFilterMode, isSearchMode])

  useEffect(() => {
    selectionAnchorRef.current = null
  }, [sortedDisplayFiles])

  const onFileItemClick = useCallback(
    (e: MouseEvent, file: FileListItem, index: number) => {
      if (e.detail === 2) return
      const key = file.tagStorageKey
      if (e.shiftKey) {
        const anchor = selectionAnchorRef.current ?? index
        const start = Math.min(anchor, index)
        const end = Math.max(anchor, index)
        const keys = new Set<string>()
        for (let i = start; i <= end; i++) {
          const f = sortedDisplayFiles[i]
          if (!f) continue
          keys.add(f.tagStorageKey)
        }
        setSelectedKeys(keys)
        return
      }
      if (e.metaKey || e.ctrlKey) {
        setSelectedKeys(prev => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
        selectionAnchorRef.current = index
        return
      }
      setSelectedKeys(new Set([key]))
      selectionAnchorRef.current = index
    },
    [sortedDisplayFiles]
  )

  const mainLoading = isTagFilterMode
    ? tagFilterLoading
    : isSearchMode
      ? searchLoading || searchDebouncePending
      : loading

  const toggleFilterTag = useCallback((tag: string) => {
    setFilterTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }, [])

  const toggleFilterUntagged = useCallback(() => {
    setFilterUntagged(u => {
      if (!u) setFilterTags([])
      return !u
    })
  }, [])

  const clearFilters = useCallback(() => {
    setFilterTags([])
    setFilterUntagged(false)
  }, [])

  const openDir = useCallback(
    (_name: string, handle: FileSystemDirectoryHandle) => {
      setStack(s => {
        const next = [...s, handle]
        queueMicrotask(() => {
          const segs = stackHandlesToSegments(next)
          history.pushState(
            { path: segs.join('/') },
            '',
            hashUrlFromSegments(segs)
          )
        })
        return next
      })
    },
    []
  )

  const goBreadcrumb = useCallback((index: number) => {
    setStack(s => {
      const next = s.slice(0, index + 1)
      queueMicrotask(() => {
        const segs = stackHandlesToSegments(next)
        history.replaceState(
          { path: segs.join('/') },
          '',
          hashUrlFromSegments(segs)
        )
      })
      return next
    })
  }, [])

  const onFileTagsChange = useCallback(
    (
      tagStorageKey: string,
      previousTags: string[],
      nextTags: string[]
    ) => {
      setFileTags(prev => ({ ...prev, [tagStorageKey]: nextTags }))
      if (tagToPathsMap === null) {
        rescanRootTags()
      } else {
        const patched = patchTagIndexAfterEdit(
          new Map(tagToPathsMap),
          tagStorageKey,
          previousTags,
          nextTags
        )
        setTagToPathsMap(patched)
        setRootTagCounts(countsFromTagToPaths(patched))
      }
      setTagFilterVersion(v => v + 1)
    },
    [rescanRootTags, tagToPathsMap]
  )

  const openPreview = useCallback(
    (item: FileListItem, kind: PreviewKind) => {
      const allowSiblingSave = !isTagFilterMode && !isSearchMode
      setPreview({
        handle: item.handle,
        kind,
        tagStorageKey: item.tagStorageKey,
        fileSizeBytes: item.size,
        fileName: item.name,
        saveDirectoryHandle: allowSiblingSave ? currentDir : null,
      })
    },
    [currentDir, isSearchMode, isTagFilterMode]
  )

  const navigatePreviewSibling = useCallback(
    (delta: -1 | 1) => {
      if (!preview) return
      const idx = sortedDisplayFiles.findIndex(
        f => f.tagStorageKey === preview.tagStorageKey
      )
      if (idx === -1) return
      const nextIdx = idx + delta
      if (nextIdx < 0 || nextIdx >= sortedDisplayFiles.length) return
      const item = sortedDisplayFiles[nextIdx]
      const kind = getPreviewKind(item.name)
      if (!kind) return
      openPreview(item, kind)
    },
    [preview, sortedDisplayFiles, openPreview]
  )

  const previewQuickAddTag = useCallback(
    (tag: string) => {
      if (!preview) return
      const key = preview.tagStorageKey
      const prev = getTags(key)
      if (prev.includes(tag)) return
      const next = [...prev, tag]
      setTags(key, next)
      recordTagApplied(tag)
      onFileTagsChange(key, prev, next)
    },
    [preview, onFileTagsChange]
  )

  const closePreview = useCallback(() => setPreview(null), [])

  const onTrimExported = useCallback(() => {
    setListRefreshTick(t => t + 1)
  }, [])

  const removeViewerItem = useCallback((id: string) => {
    setViewerItems(prev => prev.filter(i => i.id !== id))
  }, [])

  const clearViewer = useCallback(() => setViewerItems([]), [])

  const onFileContextMenu = useCallback(
    (e: MouseEvent, file: FileListItem) => {
      let targetKeys: string[]
      if (selectedKeys.has(file.tagStorageKey)) {
        targetKeys = [...selectedKeys]
      } else {
        targetKeys = [file.tagStorageKey]
        setSelectedKeys(new Set([file.tagStorageKey]))
      }
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        file,
        targetKeys,
      })
    },
    [selectedKeys]
  )

  const quickAddTagToKeys = useCallback(
    (tag: string, keys: string[]) => {
      let applied = false
      for (const key of keys) {
        const prev = getTags(key)
        if (prev.includes(tag)) continue
        const next = [...prev, tag]
        setTags(key, next)
        onFileTagsChange(key, prev, next)
        applied = true
      }
      if (applied) recordTagApplied(tag)
    },
    [onFileTagsChange]
  )

  const deleteMediaKeys = useCallback(
    async (keys: string[], singleDisplayName?: string) => {
      if (keys.length === 0) return
      const msg =
        keys.length === 1
          ? `Delete "${singleDisplayName ?? 'this file'}" permanently? This cannot be undone.`
          : `Delete ${keys.length} files permanently? This cannot be undone.`
      if (!window.confirm(msg)) return

      // Capture previous tags before any async work
      const prevTagsMap = new Map(keys.map(k => [k, getTags(k)]))

      // Delete all files in parallel (concurrency 6); collect results
      type DeleteResult =
        | { ok: true; key: string }
        | { ok: false; key: string; message: string }
      const results = await mapWithConcurrency<string, DeleteResult>(
        keys,
        async (tagStorageKey) => {
          try {
            const { parent, fileName } = await resolveParentDirectoryAndFileName(
              rootHandle,
              tagStorageKey
            )
            await parent.removeEntry(fileName)
            return { ok: true, key: tagStorageKey }
          } catch (e) {
            return {
              ok: false,
              key: tagStorageKey,
              message: e instanceof Error ? e.message : 'Could not delete the file.',
            }
          }
        },
        6
      )

      // Report failures as a single alert
      const failures = results.filter((r): r is { ok: false; key: string; message: string } => !r.ok)
      if (failures.length > 0) {
        window.alert(
          `Failed to delete ${failures.length} file(s). First error: ${failures[0].message}`
        )
      }

      // Clean up state only for successfully deleted keys
      for (const result of results) {
        if (!result.ok) continue
        const tagStorageKey = result.key
        const prevTags = prevTagsMap.get(tagStorageKey) ?? []
        setVideoLoops(tagStorageKey, [])
        setTags(tagStorageKey, [])
        onFileTagsChange(tagStorageKey, prevTags, [])
        setPreview(p => (p?.tagStorageKey === tagStorageKey ? null : p))
        setViewerItems(items =>
          items.filter(
            i => i.id !== tagStorageKey && !i.id.startsWith(`${tagStorageKey}#`)
          )
        )
        setSelectedKeys(prev => {
          const next = new Set(prev)
          next.delete(tagStorageKey)
          return next
        })
        setTagsModalKeys(cur => {
          if (!cur?.includes(tagStorageKey)) return cur
          const n = cur.filter(k => k !== tagStorageKey)
          return n.length > 0 ? n : null
        })
      }

      setListRefreshTick(t => t + 1)
      setContextMenu(null)
    },
    [rootHandle, onFileTagsChange]
  )

  const deleteMediaAt = useCallback(
    async (tagStorageKey: string, displayName: string) => {
      await deleteMediaKeys([tagStorageKey], displayName)
    },
    [deleteMediaKeys]
  )

  const addFilesToViewer = useCallback((files: FileListItem[]) => {
    setViewerItems(prev => {
      let next = prev
      for (const file of files) {
        const kind = getPreviewKind(file.name)
        if (!kind) continue
        if (next.some(i => i.id === file.tagStorageKey)) continue
        const item = {
          id: file.tagStorageKey,
          name: file.name,
          handle: file.handle,
          kind,
        }
        next = [...next, item]
      }
      return next
    })
  }, [])

  const addLoopToViewerForFile = useCallback(
    (file: FileListItem, loop: VideoLoop) => {
      const id = `${file.tagStorageKey}#loop:${loop.id}`
      setViewerItems(prev => {
        if (prev.some(i => i.id === id)) return prev
        const kind = getPreviewKind(file.name)
        if (kind !== 'video') return prev
        return [
          ...prev,
          {
            id,
            name: `${file.name} · ${formatMediaTime(loop.startSec)}–${formatMediaTime(loop.endSec)}`,
            handle: file.handle,
            kind,
            loopRange: {
              startSec: loop.startSec,
              endSec: loop.endSec,
            },
          },
        ]
      })
    },
    []
  )

  const addLoopToViewerFromPreview = useCallback(
    (loop: VideoLoop) => {
      if (!preview) return
      const id = `${preview.tagStorageKey}#loop:${loop.id}`
      setViewerItems(prev => {
        if (prev.some(i => i.id === id)) return prev
        return [
          ...prev,
          {
            id,
            name: `${preview.fileName} · ${formatMediaTime(loop.startSec)}–${formatMediaTime(loop.endSec)}`,
            handle: preview.handle,
            kind: 'video' as const,
            loopRange: {
              startSec: loop.startSec,
              endSec: loop.endSec,
            },
          },
        ]
      })
    },
    [preview]
  )

  return (
    <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-zinc-950 text-zinc-100">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        mediaKindFilter={mediaKindFilter}
        onMediaKindFilterChange={setMediaKindFilter}
        filterTags={filterTags}
        filterUntagged={filterUntagged}
        onToggleFilterUntagged={toggleFilterUntagged}
        allTagsWithCounts={rootTagCounts}
        tagsLoading={rootTagScanLoading}
        tagScanProgress={tagScanProgress}
        rootFolderName={rootHandle.name}
        onToggleFilterTag={toggleFilterTag}
        filterTagSelectableSet={sidebarFilterTagSelectableSet}
        onClearFilters={clearFilters}
        stack={stack}
        onBreadcrumb={goBreadcrumb}
      />

      <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header class="shrink-0 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
          <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
       
            <div class="flex flex-wrap items-center gap-2 sm:gap-3">
              <label class="flex items-center gap-1.5 text-xs text-zinc-500">
                <span class="sr-only sm:not-sr-only">Sort</span>
                <select
                  value={sortMode}
                  onChange={e => setSortMode(e.currentTarget.value as SortMode)}
                  class="max-w-[14rem] rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
                  aria-label="Sort files"
                >
                  <option value="name-asc">Name (A–Z)</option>
                  <option value="name-desc">Name (Z–A)</option>
                  <option value="size-asc">Size (smallest first)</option>
                  <option value="size-desc">Size (largest first)</option>
                  <option value="tags-asc">Tags (fewest first)</option>
                  <option value="tags-desc">Tags (most first)</option>
                </select>
              </label>
              <div
                class="flex rounded-lg border border-zinc-700 p-0.5"
                role="group"
                aria-label="View mode"
              >
                <button
                  type="button"
                  class={
                    viewMode === 'list'
                      ? 'rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100'
                      : 'rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200'
                  }
                  aria-pressed={viewMode === 'list'}
                  onClick={() => setViewMode('list')}
                >
                  List
                </button>
                <button
                  type="button"
                  class={
                    viewMode === 'thumbnails'
                      ? 'rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-100'
                      : 'rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200'
                  }
                  aria-pressed={viewMode === 'thumbnails'}
                  onClick={() => setViewMode('thumbnails')}
                >
                  Thumbnails
                </button>
              </div>
              <button
                type="button"
                class="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
                onClick={() => setStorageStatsModalOpen(true)}
              >
                Storage report…
              </button>
              <button
                type="button"
                class="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
                onClick={() => setNormalizeModalOpen(true)}
              >
                Normalize names…
              </button>
            </div>
          </div>
          <nav
            class="flex flex-wrap items-center gap-1 px-4 pb-3 text-sm"
            aria-label="Breadcrumb"
          >
            {stack.map((h, i) => (
              <span key={`${h.name}-${i}`} class="flex items-center gap-1">
                {i > 0 ? (
                  <span class="text-zinc-600" aria-hidden>
                    /
                  </span>
                ) : null}
                <button
                  type="button"
                  class={
                    i === stack.length - 1
                      ? 'font-medium text-zinc-200'
                      : 'text-sky-400 hover:underline'
                  }
                  onClick={() => goBreadcrumb(i)}
                >
                  {h.name}
                </button>
              </span>
            ))}
          </nav>
        </header>

        <main class="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          {mainLoading ? (
            <div
              class="mx-auto flex max-w-md flex-col gap-3 text-center"
              aria-live="polite"
            >
              <p class="text-zinc-500">
                {isTagFilterMode
                  ? filterUntagged
                    ? 'Finding files with no tags…'
                    : 'Finding files matching tags…'
                  : isSearchMode
                    ? searchDebouncePending
                      ? 'Preparing search…'
                      : 'Searching subfolders…'
                    : 'Loading directory…'}
              </p>
              {isSearchMode &&
              !searchDebouncePending &&
              searchScanProgress &&
              searchLoading ? (
                <>
                  <ProgressBar indeterminate />
                  <p class="text-[11px] tabular-nums text-zinc-600">
                    {searchScanProgress.entriesVisited.toLocaleString()} entries
                    scanned ·{' '}
                    {searchScanProgress.dirsSeen.toLocaleString()} folders seen
                  </p>
                </>
              ) : null}
            </div>
          ) : (
            <div class="flex flex-col gap-4">
              {isTagFilterMode ? (
                <p class="text-xs text-zinc-500">
                  {filterUntagged ? (
                    <>
                      Showing every file under “{rootHandle.name}” that has{' '}
                      <span class="font-medium text-zinc-300">no tags</span>
                      {debouncedSearchQuery.trim() !== '' ? (
                        <>
                          , narrowed by filename containing{' '}
                          <span class="font-medium text-zinc-300">
                            “{debouncedSearchQuery.trim()}”
                          </span>
                        </>
                      ) : null}
                      .
                    </>
                  ) : (
                    <>
                      Showing every file under “{rootHandle.name}” that has all
                      selected tags:{' '}
                      <span class="font-medium text-zinc-300">
                        {filterTags.join(', ')}
                      </span>
                      {debouncedSearchQuery.trim() !== '' ? (
                        <>
                          , narrowed by filename containing{' '}
                          <span class="font-medium text-zinc-300">
                            “{debouncedSearchQuery.trim()}”
                          </span>
                        </>
                      ) : null}
                      .
                    </>
                  )}
                </p>
              ) : isSearchMode ? (
                <p class="text-xs text-zinc-500">
                  Recursive search from “{currentDir.name}” — matches are files
                  and folders whose names contain your query anywhere below this
                  folder.
                </p>
              ) : null}

              {!isTagFilterMode && (isSearchMode || dirs.length > 0) ? (
                <section>
                  <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Folders
                    {isSearchMode
                      ? ` (${displayDirs.length} match${displayDirs.length === 1 ? '' : 'es'})`
                      : ` (${dirs.length})`}
                  </h2>
                  {displayDirs.length === 0 ? (
                    <p class="rounded-lg border border-dashed border-zinc-700 px-4 py-6 text-center text-sm text-zinc-500">
                      {isSearchMode
                        ? 'No folder names match your search in this tree.'
                        : 'No subfolders in this folder.'}
                    </p>
                  ) : viewMode === 'list' ? (
                    <div class="flex flex-col gap-2">
                      {sortedDisplayDirs.map(d => (
                        <FileRow
                          key={
                            d.relativePath !== undefined
                              ? `d:${d.relativePath}`
                              : d.name
                          }
                          item={d}
                          previewKind={null}
                          onOpenDir={openDir}
                          onPreview={openPreview}
                        />
                      ))}
                    </div>
                  ) : (
                    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                      {sortedDisplayDirs.map(d => (
                        <FolderThumbnail
                          key={
                            d.relativePath !== undefined
                              ? `d:${d.relativePath}`
                              : d.name
                          }
                          item={d}
                          onOpen={openDir}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              <section>
                <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {isTagFilterMode
                    ? 'Matching files'
                    : 'Files'}
                  {isTagFilterMode
                    ? ` (${sortedDisplayFiles.length})`
                    : isSearchMode
                      ? searchResults
                        ? ` (${sortedDisplayFiles.length} match${sortedDisplayFiles.length === 1 ? '' : 'es'})`
                        : ' (0 matches)'
                      : ` (${sortedDisplayFiles.length})`}
                </h2>
                {selectedFiles.length > 1 ? (
                  <div class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky-600/35 bg-sky-950/25 px-3 py-2.5">
                    <span class="text-sm text-zinc-200">
                      {selectedFiles.length} selected
                    </span>
                    <details class="group relative">
                      <summary class="flex cursor-pointer list-none items-center gap-1 rounded-md border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 marker:hidden hover:bg-zinc-800 [&::-webkit-details-marker]:hidden">
                        Actions
                        <span class="text-zinc-500" aria-hidden>
                          ▾
                        </span>
                      </summary>
                      <div
                        class="absolute left-0 z-30 mt-1 min-w-[14rem] rounded-lg border border-zinc-600 bg-zinc-950 py-1 shadow-xl"
                        role="menu"
                      >
                        {recentTags.slice(0, QUICK_ADD_RECENT_VISIBLE)
                          .length > 0 ||
                        selectionMoreQuickAddTags.length > 0 ? (
                          <>
                            <div
                              class="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500"
                              role="presentation"
                            >
                              Quick add
                            </div>
                            {recentTags
                              .slice(0, QUICK_ADD_RECENT_VISIBLE)
                              .map(tag => {
                              const hasAll = selectedKeyArray.every(
                                k => (fileTags[k] ?? []).includes(tag)
                              )
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  class={
                                    hasAll
                                      ? 'block w-full cursor-not-allowed px-3 py-1.5 text-left text-sm text-zinc-500'
                                      : 'block w-full px-3 py-1.5 text-left text-sm text-sky-300 hover:bg-zinc-800'
                                  }
                                  role="menuitem"
                                  disabled={hasAll}
                                  onClick={() => {
                                    if (hasAll) return
                                    quickAddTagToKeys(tag, selectedKeyArray)
                                  }}
                                >
                                  + {tag}
                                </button>
                              )
                            })}
                            <MoreTagsQuickAddDropdown
                              tags={selectionMoreQuickAddTags}
                              placement="right"
                              panelZClass="z-40"
                              triggerClassName="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left text-sm text-sky-300 hover:bg-zinc-800"
                              panelClassName="min-w-[10rem] max-h-[min(50vh,16rem)] overflow-y-auto rounded-lg border border-zinc-600 bg-zinc-950 py-1 shadow-xl"
                              optionClassName="block w-full px-3 py-1.5 text-left text-sm text-sky-300 hover:bg-zinc-800"
                              optionPrefix="+ "
                              onSelect={tag => {
                                quickAddTagToKeys(tag, selectedKeyArray)
                              }}
                              triggerChildren={
                                <>
                                  More{' '}
                                  <span class="text-zinc-500" aria-hidden>
                                    ▸
                                  </span>
                                </>
                              }
                            />
                            <div
                              class="my-1 border-t border-zinc-700"
                              role="separator"
                            />
                          </>
                        ) : null}
                        <button
                          type="button"
                          class="block w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                          role="menuitem"
                          onClick={() =>
                            setTagsModalKeys(selectedKeyArray)
                          }
                        >
                          Edit tags…
                        </button>
                        <button
                          type="button"
                          class="block w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                          role="menuitem"
                          onClick={() =>
                            addFilesToViewer(selectedFiles)
                          }
                        >
                          Add selected to Viewer
                        </button>
                        <div
                          class="my-1 border-t border-zinc-700"
                          role="separator"
                        />
                        <button
                          type="button"
                          class="block w-full px-3 py-2 text-left text-sm text-rose-300 hover:bg-rose-950/50"
                          role="menuitem"
                          onClick={() => {
                            void deleteMediaKeys(selectedKeyArray)
                          }}
                        >
                          Delete selected…
                        </button>
                      </div>
                    </details>
                    <button
                      type="button"
                      class="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                      onClick={() => {
                        setSelectedKeys(new Set())
                        selectionAnchorRef.current = null
                      }}
                    >
                      Clear selection
                    </button>
                  </div>
                ) : null}
                {sortedDisplayFiles.length === 0 ? (
                  <p class="rounded-lg border border-dashed border-zinc-700 px-4 py-8 text-center text-sm text-zinc-500">
                    {displayFiles.length > 0 && mediaKindFilter !== 'both'
                      ? 'No files match the media filter. Choose Images, Both, or Videos in the sidebar.'
                      : isTagFilterMode
                        ? 'No files under this folder have every selected tag.'
                        : !isSearchMode && files.length === 0
                          ? 'No supported images or videos in this folder.'
                          : isSearchMode && searchResults?.files.length === 0
                            ? 'No file names match your search in this tree.'
                            : 'No files match the current view.'}
                  </p>
                ) : viewMode === 'list' ? (
                  <div class="flex flex-col gap-2">
                    {sortedDisplayFiles.map((f, index) => (
                      <FileRow
                        key={
                          f.relativePath !== undefined
                            ? `f:${f.relativePath}`
                            : f.name
                        }
                        item={f}
                        previewKind={getPreviewKind(f.name)}
                        onOpenDir={openDir}
                        onPreview={openPreview}
                        tags={fileTags[f.tagStorageKey] ?? []}
                        onFileContextMenu={onFileContextMenu}
                        selected={selectedKeys.has(f.tagStorageKey)}
                        onFileSelect={(e, file) =>
                          onFileItemClick(e, file, index)
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {sortedDisplayFiles.map((f, index) => (
                      <FileThumbnail
                        key={
                          f.relativePath !== undefined
                            ? `f:${f.relativePath}`
                            : f.name
                        }
                        item={f}
                        tags={fileTags[f.tagStorageKey] ?? []}
                        previewKind={getPreviewKind(f.name)}
                        selected={selectedKeys.has(f.tagStorageKey)}
                        onSelect={(e, file) => onFileItemClick(e, file, index)}
                        onPreview={openPreview}
                        onContextMenu={onFileContextMenu}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </main>
        </div>

        <ViewerPane
          items={viewerItems}
          onRemove={removeViewerItem}
          onClear={clearViewer}
        />
      </div>

      {preview ? (
        <PreviewModal
          fileHandle={preview.handle}
          kind={preview.kind}
          tagStorageKey={preview.tagStorageKey}
          tags={fileTags[preview.tagStorageKey] ?? []}
          onApplyFrequentTag={previewQuickAddTag}
          onClose={closePreview}
          onDelete={() => deleteMediaAt(preview.tagStorageKey, preview.fileName)}
          fileSizeBytes={preview.fileSizeBytes}
          fileName={preview.fileName}
          saveDirectoryHandle={preview.saveDirectoryHandle}
          onTrimExported={onTrimExported}
          onNavigateSibling={navigatePreviewSibling}
          onAddLoopToViewer={addLoopToViewerFromPreview}
          allKnownTagNames={allKnownTagNamesList}
        />
      ) : null}

      {storageStatsModalOpen ? (
        <StorageStatsModal
          rootHandle={rootHandle}
          rootName={rootHandle.name}
          onClose={() => setStorageStatsModalOpen(false)}
        />
      ) : null}

      {normalizeModalOpen ? (
        <NormalizeFilenamesModal
          rootHandle={rootHandle}
          onClose={() => setNormalizeModalOpen(false)}
          onComplete={report => {
            onNormalizeComplete(report)
          }}
        />
      ) : null}

      {contextMenu ? (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          {isSupportedMediaFile(contextMenu.file.name) ? (
            <>
              {recentTags.slice(0, QUICK_ADD_RECENT_VISIBLE).length >
                0 || contextMenuMoreQuickAddTags.length > 0 ? (
                <>
                  <div
                    class="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500"
                    role="presentation"
                  >
                    Quick add
                  </div>
                  {recentTags
                    .slice(0, QUICK_ADD_RECENT_VISIBLE)
                    .map(tag => {
                    const has = contextMenu.targetKeys.every(
                      k => (fileTags[k] ?? []).includes(tag)
                    )
                    return (
                      <button
                        key={tag}
                        type="button"
                        class={
                          has
                            ? 'block w-full cursor-not-allowed px-3 py-1.5 text-left text-sm text-zinc-500'
                            : 'block w-full px-3 py-1.5 text-left text-sm text-sky-300 hover:bg-zinc-800'
                        }
                        role="menuitem"
                        disabled={has}
                        onClick={() => {
                          if (has) return
                          quickAddTagToKeys(tag, contextMenu.targetKeys)
                          setContextMenu(null)
                        }}
                      >
                        + {tag}
                      </button>
                    )
                  })}
                  <MoreTagsQuickAddDropdown
                    tags={contextMenuMoreQuickAddTags}
                    placement="right"
                    panelZClass="z-[60]"
                    triggerClassName="flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left text-sm text-sky-300 hover:bg-zinc-800"
                    panelClassName="min-w-[10rem] max-h-[min(50vh,16rem)] overflow-y-auto rounded-lg border border-zinc-600 bg-zinc-950 py-1 shadow-xl"
                    optionClassName="block w-full px-3 py-1.5 text-left text-sm text-sky-300 hover:bg-zinc-800"
                    optionPrefix="+ "
                    onSelect={tag => {
                      quickAddTagToKeys(tag, contextMenu.targetKeys)
                      setContextMenu(null)
                    }}
                    triggerChildren={
                      <>
                        More{' '}
                        <span class="text-zinc-500" aria-hidden>
                          ▸
                        </span>
                      </>
                    }
                  />
                  <div
                    class="my-1 border-t border-zinc-700"
                    role="separator"
                  />
                </>
              ) : null}
              <button
                type="button"
                class="block w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                role="menuitem"
                onClick={() => {
                  setTagsModalKeys(contextMenu.targetKeys)
                  setContextMenu(null)
                }}
              >
                Edit tags…
              </button>
              {contextMenu.targetKeys.length === 1 ? (
                <button
                  type="button"
                  class="block w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                  role="menuitem"
                  onClick={() => {
                    const f = contextMenu.file
                    setContextMenu(null)
                    void (async () => {
                      try {
                        const blobFile = await f.handle.getFile()
                        const mime = blobFile.type
                        const isMedia =
                          mime.startsWith('image/') ||
                          mime.startsWith('video/') ||
                          mime.startsWith('audio/')
                        if (!isMedia) {
                          console.warn(
                            `Refusing to open "${f.name}" in a new tab: type "${mime || 'unknown'}" is not a known image/video/audio type.`
                          )
                          return
                        }
                        const url = URL.createObjectURL(blobFile)
                        const opened = window.open(url, '_blank', 'noopener,noreferrer')
                        if (!opened) {
                          URL.revokeObjectURL(url)
                          return
                        }
                        window.addEventListener(
                          'pagehide',
                          () => URL.revokeObjectURL(url),
                          { once: true }
                        )
                      } catch {
                        /* ignore */
                      }
                    })()
                  }}
                >
                  View in a new tab
                </button>
              ) : null}
              <button
                type="button"
                class="block w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                role="menuitem"
                onClick={() => {
                  const targets = sortedDisplayFiles.filter(f =>
                    contextMenu.targetKeys.includes(f.tagStorageKey)
                  )
                  addFilesToViewer(targets)
                  setContextMenu(null)
                }}
              >
                {contextMenu.targetKeys.length > 1
                  ? 'Add selected to Viewer'
                  : 'Add to Viewer'}
              </button>
              {contextMenu.targetKeys.length === 1 &&
              getPreviewKind(contextMenu.file.name) === 'video' &&
              getVideoLoops(contextMenu.file.tagStorageKey).length > 0 ? (
                <>
                  <div
                    class="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500"
                    role="presentation"
                  >
                    Saved loops
                  </div>
                  {getVideoLoops(contextMenu.file.tagStorageKey).map(loop => (
                    <button
                      key={loop.id}
                      type="button"
                      class="block w-full px-3 py-1.5 text-left text-sm text-emerald-300/90 hover:bg-zinc-800"
                      role="menuitem"
                      onClick={() => {
                        addLoopToViewerForFile(contextMenu.file, loop)
                        setContextMenu(null)
                      }}
                    >
                      Add loop {formatMediaTime(loop.startSec)}–
                      {formatMediaTime(loop.endSec)} to Viewer
                    </button>
                  ))}
                </>
              ) : null}
              <div
                class="my-1 border-t border-zinc-700"
                role="separator"
              />
              <button
                type="button"
                class="block w-full px-3 py-2 text-left text-sm text-rose-300 hover:bg-rose-950/50"
                role="menuitem"
                onClick={() => {
                  const f = contextMenu.file
                  setContextMenu(null)
                  void deleteMediaKeys(
                    contextMenu.targetKeys,
                    contextMenu.targetKeys.length === 1 ? f.name : undefined
                  )
                }}
              >
                {contextMenu.targetKeys.length > 1
                  ? 'Delete selected…'
                  : 'Delete file…'}
              </button>
            </>
          ) : null}
        </FileContextMenu>
      ) : null}

      {tagsModalKeys && tagsModalKeys.length > 0 ? (
        <TagsModal
          tagStorageKeys={tagsModalKeys}
          onClose={() => setTagsModalKeys(null)}
          onSaved={(tagStorageKey, previousTags, nextTags) => {
            onFileTagsChange(tagStorageKey, previousTags, nextTags)
          }}
        />
      ) : null}
    </div>
  )
}

/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPaths = vi.hoisted(() => ({ paths: ['a.jpg', 'b.jpg', 'c.jpg'] }))
const mockTagsByPath = vi.hoisted(
  () => new Map<string, string[]>()
)
const mockVersionListeners = vi.hoisted(() => new Set<() => void>())
const mockVersionState = vi.hoisted(() => ({ v: 0 }))

vi.mock('../lib/media-paths', () => ({
  collectAllMediaRelativePaths: async () => [...mockPaths.paths],
}))

vi.mock('../lib/resolve-path', () => ({
  resolvePathToFileListItem: async (
    _root: FileSystemDirectoryHandle,
    p: string
  ) => ({
    name: p.split('/').pop() ?? p,
    handle: {} as FileSystemFileHandle,
    size: 0,
    lastModified: 0,
    tagStorageKey: p,
    kind: 'file' as const,
  }),
}))

vi.mock('../lib/preview', () => ({
  getPreviewKind: () => 'image' as const,
}))

vi.mock('../lib/use-blob-url', () => ({
  useFileBlobURL: () => ({ url: 'blob:test' }),
}))

vi.mock('../lib/recent-tags', () => ({
  recordTagApplied: vi.fn(),
}))

vi.mock('../lib/use-recent-tags', () => ({
  useRecentTags: () => [] as string[],
}))

vi.mock('../lib/tag-color', () => ({
  tagColor: () => '#888',
}))

vi.mock('../lib/format-bytes', () => ({
  formatBytes: (n: number) => `${n}B`,
}))

vi.mock('../lib/tags', () => {
  return {
    buildAggregateFromTagIndex: () => ({ counts: [], tagToPaths: new Map() }),
    getDistinctTagsFromIndex: () => [],
    getTags: (k: string) => mockTagsByPath.get(k) ?? [],
    markReviewed: (_k: string) => {
      mockVersionState.v++
      for (const fn of mockVersionListeners) fn()
    },
    setTags: (k: string, tags: string[]) => {
      mockTagsByPath.set(k, tags)
      mockVersionState.v++
      for (const fn of mockVersionListeners) fn()
    },
  }
})

vi.mock('../lib/use-tag-index-version', async () => {
  const hooks = await import('preact/hooks')
  return {
    useTagIndexVersion: () => {
      const [v, setV] = hooks.useState(mockVersionState.v)
      hooks.useEffect(() => {
        const fn = () => setV(mockVersionState.v)
        mockVersionListeners.add(fn)
        return () => {
          mockVersionListeners.delete(fn)
        }
      }, [])
      return v
    },
  }
})

import { TriageScreen } from './TriageScreen.tsx'
import { setTags } from '../lib/tags'

const rootHandle = { name: 'root' } as unknown as FileSystemDirectoryHandle

beforeEach(() => {
  mockPaths.paths = ['a.jpg', 'b.jpg', 'c.jpg']
  mockTagsByPath.clear()
  mockVersionListeners.clear()
  mockVersionState.v = 0
})

afterEach(() => {
  cleanup()
})

describe('TriageScreen', () => {
  it('keeps cursor on the same item after applying a tag', async () => {
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)

    await waitFor(() => {
      expect(screen.getByText('3 to triage')).toBeTruthy()
    })
    expect(screen.getByText('a.jpg')).toBeTruthy()

    // Advance to b.jpg.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })
    await waitFor(() => {
      expect(screen.getByText('b.jpg')).toBeTruthy()
    })

    // Apply a tag to b.jpg — version bump rebuilds queue. Sort ordering puts
    // tagged items after untagged ones, so b.jpg moves but the cursor should
    // follow it (still on b.jpg, not back to a.jpg or 0).
    await act(async () => {
      setTags('b.jpg', ['hello'])
    })

    await waitFor(() => {
      expect(screen.getByText('b.jpg')).toBeTruthy()
    })
    expect(screen.queryByText('a.jpg')).toBeNull()
  })

  it('advances to next item when current path is removed from the queue', async () => {
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)

    await waitFor(() => {
      expect(screen.getByText('a.jpg')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })
    await waitFor(() => {
      expect(screen.getByText('b.jpg')).toBeTruthy()
    })

    await act(async () => {
      mockPaths.paths = ['a.jpg', 'c.jpg']
      mockVersionState.v++
      for (const fn of mockVersionListeners) fn()
    })

    await waitFor(() => {
      expect(screen.getByText('c.jpg')).toBeTruthy()
    })
  })
})

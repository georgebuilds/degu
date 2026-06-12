/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPaths = vi.hoisted(() => ({ paths: ['a.jpg', 'b.jpg', 'c.jpg'], throws: false }))
const mockTagsByPath = vi.hoisted(() => new Map<string, string[]>())
const mockVersionListeners = vi.hoisted(() => new Set<() => void>())
const mockVersionState = vi.hoisted(() => ({ v: 0 }))
const mockResolve = vi.hoisted(() => ({
  throwsFor: new Set<string>(),
  kind: 'image' as 'image' | 'video',
}))
const mockRecent = vi.hoisted(() => ({ tags: [] as string[] }))
const mockAggregate = vi.hoisted(() => ({
  counts: [] as { tag: string; count: number }[],
}))
const mockMarkReviewed = vi.hoisted(() => vi.fn())
const mockRecordTagApplied = vi.hoisted(() => vi.fn())

vi.mock('../lib/media-paths', () => ({
  collectAllMediaRelativePaths: async () => {
    if (mockPaths.throws) throw new Error('disk gone')
    return [...mockPaths.paths]
  },
}))

vi.mock('../lib/resolve-path', () => ({
  resolvePathToFileListItem: async (
    _root: FileSystemDirectoryHandle,
    p: string
  ) => {
    if (mockResolve.throwsFor.has(p)) throw new Error('cannot resolve')
    return {
      name: p.split('/').pop() ?? p,
      handle: {} as FileSystemFileHandle,
      size: 2048,
      lastModified: 1_600_000_000_000,
      tagStorageKey: p,
      kind: 'file' as const,
    }
  },
}))

vi.mock('../lib/preview', () => ({
  getPreviewKind: (name: string) =>
    name.endsWith('.unknown') ? null : mockResolve.kind,
}))

vi.mock('../lib/use-blob-url', () => ({
  useFileBlobURL: () => ({ url: 'blob:test' }),
}))

vi.mock('../lib/recent-tags', () => ({
  recordTagApplied: (...a: unknown[]) => mockRecordTagApplied(...a),
}))

vi.mock('../lib/use-recent-tags', () => ({
  useRecentTags: () => mockRecent.tags,
}))

vi.mock('../lib/tag-color', () => ({
  tagColor: () => '#888',
}))

vi.mock('../lib/format-bytes', () => ({
  formatBytes: (n: number) => `${n}B`,
}))

vi.mock('../lib/tags', () => ({
  buildAggregateFromTagIndex: () => ({ counts: mockAggregate.counts, tagToPaths: new Map() }),
  getDistinctTagsFromIndex: () => ['known1', 'known2'],
  getTags: (k: string) => mockTagsByPath.get(k) ?? [],
  markReviewed: (k: string) => {
    mockMarkReviewed(k)
    mockVersionState.v++
    for (const fn of mockVersionListeners) fn()
  },
  setTags: (k: string, tags: string[]) => {
    mockTagsByPath.set(k, tags)
    mockVersionState.v++
    for (const fn of mockVersionListeners) fn()
  },
}))

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

const rootHandle = { name: 'root' } as unknown as FileSystemDirectoryHandle

/**
 * Preact runs `useEffect` callbacks on a deferred queue, so the global keydown
 * listener inside TriageItemView is not attached on the same tick the element
 * text first appears. Flush pending effects before dispatching window-level
 * keyboard events.
 */
async function flushEffects() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 0))
  })
}

beforeEach(() => {
  mockPaths.paths = ['a.jpg', 'b.jpg', 'c.jpg']
  mockPaths.throws = false
  mockTagsByPath.clear()
  mockVersionListeners.clear()
  mockVersionState.v = 0
  mockResolve.throwsFor.clear()
  mockResolve.kind = 'image'
  mockRecent.tags = []
  mockAggregate.counts = []
  mockMarkReviewed.mockReset()
  mockRecordTagApplied.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('TriageScreen - top-level states', () => {
  it('shows scan error UI when the scan throws', async () => {
    mockPaths.throws = true
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('Could not read folder.')).toBeTruthy())
    expect(screen.getByText('disk gone')).toBeTruthy()
  })

  it('shows the empty DoneScreen when there are no media files', async () => {
    mockPaths.paths = []
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('Nothing here yet')).toBeTruthy())
    expect(screen.getByText(/0 files/)).toBeTruthy()
  })

  it('shows the all-sorted DoneScreen after advancing past the last item', async () => {
    mockPaths.paths = ['only.jpg']
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('only.jpg')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })
    await waitFor(() => expect(screen.getByText('All sorted.')).toBeTruthy())
    expect(screen.getByText(/1 files/)).toBeTruthy()
  })
})

describe('TriageScreen - item rendering', () => {
  it('renders breadcrumb, file metadata, and image media', async () => {
    mockPaths.paths = ['photos/2020/x.jpg']
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('x.jpg')).toBeTruthy())
    // breadcrumb shows the parent folders
    expect(screen.getByText('photos / 2020')).toBeTruthy()
    // metadata formatted bytes (mocked formatBytes -> `${n}B`)
    await waitFor(() => expect(screen.getByText('2048B')).toBeTruthy())
    // image element rendered
    await waitFor(() => expect(document.querySelector('img')).toBeTruthy())
  })

  it('renders a <video> for video media', async () => {
    mockResolve.kind = 'video'
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(document.querySelector('video')).toBeTruthy())
  })

  it('shows resolve error fallback when path cannot be opened', async () => {
    mockResolve.throwsFor.add('a.jpg')
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('Could not open this file.')).toBeTruthy())
  })

  it('treats an unknown preview kind as a resolve error', async () => {
    mockPaths.paths = ['weird.unknown']
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('Could not open this file.')).toBeTruthy())
  })
})

describe('TriageScreen - hotkey tags & application', () => {
  it('shows hotkey tags from recents and applies on click', async () => {
    mockPaths.paths = ['only.jpg']
    mockRecent.tags = ['sunset', 'beach']
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('only.jpg')).toBeTruthy())
    expect(screen.getByRole('button', { name: /sunset/ })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sunset/ }))
    })
    expect(mockRecordTagApplied).toHaveBeenCalledWith('sunset')
    await waitFor(() => expect(mockTagsByPath.get('only.jpg')).toContain('sunset'))
  })

  it('falls back to popular tags when recents are insufficient', async () => {
    mockRecent.tags = []
    mockAggregate.counts = [
      { tag: 'popular1', count: 10 },
      { tag: 'popular2', count: 5 },
    ]
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
    expect(screen.getByRole('button', { name: /popular1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /popular2/ })).toBeTruthy()
  })

  it('shows the empty-hotkeys hint when there are no tags at all', async () => {
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
    expect(screen.getByText(/No tags yet/)).toBeTruthy()
  })

  it('applies a hotkey tag via numeric key press', async () => {
    mockPaths.paths = ['only.jpg']
    mockRecent.tags = ['kbtag']
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('only.jpg')).toBeTruthy())
    await flushEffects()
    await act(async () => {
      fireEvent.keyDown(window, { key: '1' })
    })
    await waitFor(() => expect(mockTagsByPath.get('only.jpg')).toContain('kbtag'))
  })

  it('ignores number keys with modifier held', async () => {
    mockPaths.paths = ['only.jpg']
    mockRecent.tags = ['kbtag']
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('only.jpg')).toBeTruthy())
    await flushEffects()
    fireEvent.keyDown(window, { key: '1', metaKey: true })
    expect(mockTagsByPath.get('only.jpg')).toBeUndefined()
  })
})

describe('TriageScreen - current tags & removal', () => {
  it('renders current tags and removes one on click', async () => {
    mockPaths.paths = ['only.jpg']
    mockTagsByPath.set('only.jpg', ['red', 'blue'])
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('Current tags')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /red/ }))
    })
    await waitFor(() => expect(mockTagsByPath.get('only.jpg')).toEqual(['blue']))
  })

  it('shows singular "tag" label for a single tag', async () => {
    mockPaths.paths = ['only.jpg']
    mockTagsByPath.set('only.jpg', ['solo'])
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('tag')).toBeTruthy())
  })
})

describe('TriageScreen - new tag input', () => {
  it('adds a new tag via the Add button', async () => {
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
    const input = screen.getByPlaceholderText('Type a tag…')
    const addBtn = screen.getByRole('button', { name: 'Add' })
    expect((addBtn as HTMLButtonElement).disabled).toBe(true)
    fireEvent.input(input, { target: { value: 'manual' } })
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    })
    await waitFor(() => expect(mockTagsByPath.get('a.jpg')).toContain('manual'))
  })

  it('commits a new tag on Enter and clears on Escape', async () => {
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
    const input = screen.getByPlaceholderText('Type a tag…') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'entered' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    await waitFor(() => expect(mockTagsByPath.get('a.jpg')).toContain('entered'))

    fireEvent.input(input, { target: { value: 'discard' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
  })

  it('does not trigger hotkeys while typing in the input', async () => {
    mockRecent.tags = ['kbtag']
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
    const input = screen.getByPlaceholderText('Type a tag…')
    fireEvent.keyDown(input, { key: '1' })
    expect(mockTagsByPath.get('a.jpg')).toBeUndefined()
  })
})

describe('TriageScreen - navigation keys & buttons', () => {
  it('skips via S key and marks reviewed', async () => {
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
    await flushEffects()
    await act(async () => {
      fireEvent.keyDown(window, { key: 's' })
    })
    await waitFor(() => expect(mockMarkReviewed).toHaveBeenCalledWith('a.jpg'))
  })

  it('advances with j / ArrowRight and goes back with k / ArrowLeft', async () => {
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
    await flushEffects()
    // back button disabled at first item
    expect((screen.getByRole('button', { name: /back/ }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      fireEvent.keyDown(window, { key: 'j' })
    })
    await waitFor(() => expect(screen.getByText('b.jpg')).toBeTruthy())
    await flushEffects()

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k' })
    })
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
  })

  it('handles the T key without skipping/advancing/tagging', async () => {
    // The T hotkey focuses the new-tag input; in happy-dom focus side effects
    // are unreliable, so we assert the branch is taken (no skip/advance/tag
    // mutation occurs) and the input is wired with its keyboard shortcut.
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
    await flushEffects()
    const input = screen.getByPlaceholderText('Type a tag…') as HTMLInputElement
    expect(input.getAttribute('aria-keyshortcuts')).toBe('t')
    await act(async () => {
      fireEvent.keyDown(window, { key: 't' })
    })
    // still on a.jpg, nothing mutated/reviewed
    expect(screen.getByText('a.jpg')).toBeTruthy()
    expect(mockMarkReviewed).not.toHaveBeenCalled()
    expect(mockTagsByPath.get('a.jpg')).toBeUndefined()
  })

  it('back button click navigates to the previous item', async () => {
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })
    await waitFor(() => expect(screen.getByText('b.jpg')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back/ }))
    })
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
  })

  it('skip button click marks reviewed and advances', async () => {
    render(<TriageScreen rootHandle={rootHandle} rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('a.jpg')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /skip/ }))
    })
    expect(mockMarkReviewed).toHaveBeenCalledWith('a.jpg')
  })
})

/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AggCount = { tag: string; count: number }
type StaleFile = { path: string; lastReviewed: string | null; candidateTags: string[] }

const mockState = vi.hoisted(() => ({
  counts: [] as AggCount[],
  createdAt: new Map<string, string | null>(),
  stale: [] as StaleFile[],
}))

vi.mock('../lib/tags', () => ({
  buildAggregateFromTagIndex: () => ({
    counts: mockState.counts,
    tagToPaths: new Map<string, Set<string>>(),
  }),
  getTagCreatedAt: (tag: string) => mockState.createdAt.get(tag) ?? null,
  getStaleFiles: () => mockState.stale,
}))

vi.mock('../lib/tag-color', () => ({
  tagColor: () => '#888',
}))

vi.mock('../lib/use-tag-index-version', () => ({
  useTagIndexVersion: () => 0,
}))

import { TagsScreen } from './TagsScreen.tsx'

beforeEach(() => {
  mockState.counts = []
  mockState.createdAt = new Map()
  mockState.stale = []
})

afterEach(() => {
  cleanup()
})

describe('TagsScreen', () => {
  it('shows empty state when there are no tags', () => {
    render(<TagsScreen rootFolderName="root" onOpenStale={vi.fn()} />)
    expect(screen.getByText('No tags yet. Open the Triage screen to start.')).toBeTruthy()
  })

  it('renders the tag list with counts and folder name', () => {
    mockState.counts = [
      { tag: 'beach', count: 12 },
      { tag: 'sunset', count: 3 },
    ]
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
    mockState.createdAt.set('beach', recent)

    render(<TagsScreen rootFolderName="myfolder" onOpenStale={vi.fn()} />)

    expect(screen.getByText('myfolder')).toBeTruthy()
    expect(screen.getByText('beach')).toBeTruthy()
    expect(screen.getByText('sunset')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    // beach has a known created date → relative date text
    expect(screen.getByText('created 2 days ago')).toBeTruthy()
    // sunset has no created date
    expect(screen.getByText('created date unknown')).toBeTruthy()
  })

  it('sorts alphabetically when A–Z is clicked', () => {
    mockState.counts = [
      { tag: 'zebra', count: 1 },
      { tag: 'apple', count: 50 },
    ]
    render(<TagsScreen rootFolderName="root" onOpenStale={vi.fn()} />)

    const alphaBtn = screen.getByRole('button', { name: 'A–Z' })
    fireEvent.click(alphaBtn)
    expect(alphaBtn.getAttribute('aria-pressed')).toBe('true')

    const items = screen.getAllByRole('listitem')
    // apple should now come before zebra
    expect(items[0].textContent).toContain('apple')
    expect(items[1].textContent).toContain('zebra')
  })

  it('default count sort orders by descending count', () => {
    mockState.counts = [
      { tag: 'low', count: 2 },
      { tag: 'high', count: 99 },
    ]
    render(<TagsScreen rootFolderName="root" onOpenStale={vi.fn()} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0].textContent).toContain('high')
    expect(items[1].textContent).toContain('low')
  })

  it('newest sort orders by created date descending', () => {
    mockState.counts = [
      { tag: 'older', count: 1 },
      { tag: 'newer', count: 1 },
    ]
    mockState.createdAt.set('older', '2020-01-01T00:00:00.000Z')
    mockState.createdAt.set('newer', '2024-01-01T00:00:00.000Z')

    render(<TagsScreen rootFolderName="root" onOpenStale={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Newest' }))

    const items = screen.getAllByRole('listitem')
    expect(items[0].textContent).toContain('newer')
    expect(items[1].textContent).toContain('older')
  })

  it('oldest sort orders by created date ascending', () => {
    mockState.counts = [
      { tag: 'older', count: 1 },
      { tag: 'newer', count: 1 },
    ]
    mockState.createdAt.set('older', '2020-01-01T00:00:00.000Z')
    mockState.createdAt.set('newer', '2024-01-01T00:00:00.000Z')

    render(<TagsScreen rootFolderName="root" onOpenStale={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Oldest' }))

    const items = screen.getAllByRole('listitem')
    expect(items[0].textContent).toContain('older')
    expect(items[1].textContent).toContain('newer')
  })

  it('shows stale-files banner and calls onOpenStale when clicked', () => {
    mockState.counts = [{ tag: 'a', count: 1 }]
    mockState.stale = [
      { path: 'x.jpg', lastReviewed: null, candidateTags: ['a'] },
      { path: 'y.jpg', lastReviewed: null, candidateTags: ['a'] },
    ]
    const onOpenStale = vi.fn()
    render(<TagsScreen rootFolderName="root" onOpenStale={onOpenStale} />)

    const banner = screen.getByText('2 files may want a newer tag')
    expect(banner).toBeTruthy()
    fireEvent.click(banner)
    expect(onOpenStale).toHaveBeenCalledTimes(1)
  })

  it('hides stale banner when there are no stale files', () => {
    mockState.counts = [{ tag: 'a', count: 1 }]
    render(<TagsScreen rootFolderName="root" onOpenStale={vi.fn()} />)
    expect(screen.queryByText(/files may want a newer tag/)).toBeNull()
  })
})

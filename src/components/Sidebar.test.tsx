/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockApi = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  applyUpdate: vi.fn(),
}))

vi.mock('../lib/api-client', () => ({
  checkForUpdate: () => mockApi.checkForUpdate(),
  applyUpdate: () => mockApi.applyUpdate(),
}))

vi.mock('../lib/tag-color', () => ({
  tagColor: () => '#888',
}))

import { Sidebar, type TagCount } from './Sidebar.tsx'
import type { MediaKindFilter } from '../lib/supported-media'

type Props = Parameters<typeof Sidebar>[0]

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    collapsed: false,
    onToggleCollapse: vi.fn(),
    searchQuery: '',
    onSearchChange: vi.fn(),
    mediaKindFilter: 'both' as MediaKindFilter,
    onMediaKindFilterChange: vi.fn(),
    filterTags: [],
    filterUntagged: false,
    onToggleFilterUntagged: vi.fn(),
    filterTagSelectableSet: null,
    allTagsWithCounts: [] as TagCount[],
    tagsLoading: false,
    tagScanProgress: null,
    rootFolderName: 'media',
    onToggleFilterTag: vi.fn(),
    onClearFilters: vi.fn(),
    stack: [{ name: 'media' } as FileSystemDirectoryHandle],
    onBreadcrumb: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  mockApi.checkForUpdate.mockReset()
  mockApi.applyUpdate.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('Sidebar', () => {
  it('renders expanded sections and toggles collapse', () => {
    const onToggleCollapse = vi.fn()
    render(<Sidebar {...baseProps({ onToggleCollapse })} />)
    expect(screen.getByText('Navigation')).toBeTruthy()
    expect(screen.getByText('Search')).toBeTruthy()
    expect(screen.getByText('Show in browser')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Collapse sidebar'))
    expect(onToggleCollapse).toHaveBeenCalled()
  })

  it('hides body sections when collapsed', () => {
    render(<Sidebar {...baseProps({ collapsed: true })} />)
    expect(screen.queryByText('Navigation')).toBeNull()
    expect(screen.getByTitle('Expand sidebar')).toBeTruthy()
  })

  it('typing in the search box calls onSearchChange', () => {
    const onSearchChange = vi.fn()
    render(<Sidebar {...baseProps({ onSearchChange })} />)
    fireEvent.input(screen.getByPlaceholderText('Search'), {
      target: { value: 'cats' },
    })
    expect(onSearchChange).toHaveBeenCalledWith('cats')
  })

  it('media kind filter buttons report aria-pressed and fire change', () => {
    const onMediaKindFilterChange = vi.fn()
    render(
      <Sidebar
        {...baseProps({ mediaKindFilter: 'images', onMediaKindFilterChange })}
      />
    )
    const images = screen.getByRole('button', { name: 'Images' })
    expect(images.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Videos' }))
    expect(onMediaKindFilterChange).toHaveBeenCalledWith('videos')
  })

  it('renders breadcrumb stack and fires onBreadcrumb on click', () => {
    const onBreadcrumb = vi.fn()
    render(
      <Sidebar
        {...baseProps({
          stack: [
            { name: 'root' } as FileSystemDirectoryHandle,
            { name: 'sub' } as FileSystemDirectoryHandle,
          ],
          onBreadcrumb,
        })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'root' }))
    expect(onBreadcrumb).toHaveBeenCalledWith(0)
  })

  it('toggles the untagged filter', () => {
    const onToggleFilterUntagged = vi.fn()
    render(<Sidebar {...baseProps({ onToggleFilterUntagged })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Untagged' }))
    expect(onToggleFilterUntagged).toHaveBeenCalled()
  })

  it('shows empty-state message when there are no tags', () => {
    render(<Sidebar {...baseProps()} />)
    expect(screen.getByText(/No named tags yet/)).toBeTruthy()
  })

  it('renders tag list with counts and toggles a tag filter', () => {
    const onToggleFilterTag = vi.fn()
    render(
      <Sidebar
        {...baseProps({
          allTagsWithCounts: [
            { tag: 'red', count: 3 },
            { tag: 'blue', count: 1 },
          ],
          onToggleFilterTag,
        })}
      />
    )
    expect(screen.getByText('red')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /red/ }))
    expect(onToggleFilterTag).toHaveBeenCalledWith('red')
  })

  it('disables tags not in the selectable set', () => {
    render(
      <Sidebar
        {...baseProps({
          allTagsWithCounts: [
            { tag: 'red', count: 3 },
            { tag: 'blue', count: 1 },
          ],
          filterTagSelectableSet: new Set(['red']),
        })}
      />
    )
    const blue = screen.getByRole('button', { name: /blue/ }) as HTMLButtonElement
    expect(blue.disabled).toBe(true)
  })

  it('shows Clear filters when filters are active and fires onClearFilters', () => {
    const onClearFilters = vi.fn()
    render(
      <Sidebar
        {...baseProps({ filterTags: ['red'], onClearFilters })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClearFilters).toHaveBeenCalled()
  })

  it('shows the tag scanning progress (collect phase)', () => {
    render(
      <Sidebar
        {...baseProps({
          tagsLoading: true,
          tagScanProgress: {
            phase: 'collect',
            mediaFiles: 12,
            dirsVisited: 4,
          },
        })}
      />
    )
    expect(screen.getByText(/Scanning folder tree for tags/)).toBeTruthy()
    expect(screen.getByText(/media files found/)).toBeTruthy()
  })

  it('checks for updates and shows the up-to-date footer', async () => {
    mockApi.checkForUpdate.mockResolvedValue({
      current: '1.0.0',
      updateAvailable: false,
    })
    render(<Sidebar {...baseProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => {
      expect(screen.getByText(/Up to date/)).toBeTruthy()
    })
  })

  it('shows an available self-update and installs it', async () => {
    mockApi.checkForUpdate.mockResolvedValue({
      current: '1.0.0',
      latest: '1.1.0',
      updateAvailable: true,
      canSelfUpdate: true,
      releaseUrl: 'https://example.com/r',
    })
    mockApi.applyUpdate.mockResolvedValue({ success: true, newVersion: '1.1.0' })
    render(<Sidebar {...baseProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => {
      expect(screen.getByText('v1.1.0 available')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => {
      expect(screen.getByText(/Updated to v1.1.0/)).toBeTruthy()
    })
  })

  it('shows an error footer with Retry when the check fails', async () => {
    mockApi.checkForUpdate.mockRejectedValue(new Error('network'))
    render(<Sidebar {...baseProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => {
      expect(screen.getByText(/Couldn't check for updates/)).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

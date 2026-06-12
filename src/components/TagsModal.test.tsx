/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockTagsByKey = vi.hoisted(() => new Map<string, string[]>())
const mocks = vi.hoisted(() => ({
  setTags: vi.fn(),
  recordTagApplied: vi.fn(),
  getRecentTags: vi.fn((): string[] => []),
  getDistinctTagsFromIndex: vi.fn((): string[] => []),
  isSupportedMediaFile: vi.fn((_n: string): boolean => true),
}))

vi.mock('../lib/tags', () => ({
  getTags: (k: string) => mockTagsByKey.get(k) ?? [],
  setTags: (k: string, v: string[]) => {
    mockTagsByKey.set(k, v)
    mocks.setTags(k, v)
  },
  getDistinctTagsFromIndex: () => mocks.getDistinctTagsFromIndex(),
}))

vi.mock('../lib/recent-tags', () => ({
  recordTagApplied: (t: string) => mocks.recordTagApplied(t),
  getRecentTags: () => mocks.getRecentTags(),
}))

vi.mock('../lib/supported-media', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/supported-media')>()
  return {
    ...actual,
    isSupportedMediaFile: (n: string) => mocks.isSupportedMediaFile(n),
  }
})

import { TagsModal } from './TagsModal.tsx'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockTagsByKey.clear()
  mocks.getRecentTags.mockReturnValue([])
  mocks.getDistinctTagsFromIndex.mockReturnValue([])
  mocks.isSupportedMediaFile.mockReturnValue(true)
})

describe('TagsModal', () => {
  it('loads and shows existing tags for a single file', async () => {
    mockTagsByKey.set('photo.jpg', ['beach', 'sunset'])
    render(
      <TagsModal
        tagStorageKeys={['photo.jpg']}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    )

    expect(screen.getByRole('dialog', { name: 'Tags' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove tag beach' })).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Remove tag sunset' })).toBeTruthy()
  })

  it('shows "No tags yet." when the file has no tags', async () => {
    render(
      <TagsModal
        tagStorageKeys={['empty.jpg']}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(screen.getByText('No tags yet.')).toBeTruthy()
    })
  })

  it('removing a tag persists the reduced set and fires onSaved', async () => {
    mockTagsByKey.set('photo.jpg', ['a', 'b'])
    const onSaved = vi.fn()
    render(
      <TagsModal
        tagStorageKeys={['photo.jpg']}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    )

    const removeA = await screen.findByRole('button', { name: 'Remove tag a' })
    fireEvent.click(removeA)

    expect(mocks.setTags).toHaveBeenCalledWith('photo.jpg', ['b'])
    expect(onSaved).toHaveBeenCalledWith('photo.jpg', ['a', 'b'], ['b'])
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Remove tag a' })).toBeNull()
    })
  })

  it('adding a tag via the editor records it and persists for a single file', async () => {
    const onSaved = vi.fn()
    render(
      <TagsModal
        tagStorageKeys={['photo.jpg']}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    )

    const input = await screen.findByPlaceholderText('Add tags…')
    fireEvent.input(input, { target: { value: 'fresh' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.recordTagApplied).toHaveBeenCalledWith('fresh')
    expect(mocks.setTags).toHaveBeenCalledWith('photo.jpg', ['fresh'])
    expect(onSaved).toHaveBeenCalledWith('photo.jpg', [], ['fresh'])
  })

  it('multi-file mode shows the union title and explanatory text', async () => {
    mockTagsByKey.set('a.jpg', ['x'])
    mockTagsByKey.set('b.jpg', ['y'])
    render(
      <TagsModal
        tagStorageKeys={['a.jpg', 'b.jpg']}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    )

    expect(screen.getByRole('dialog', { name: 'Tags (2 files)' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove tag x' })).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Remove tag y' })).toBeTruthy()
    expect(
      screen.getByText(/union of tags on the selected files/i)
    ).toBeTruthy()
  })

  it('multi-file save applies the same set to every key', async () => {
    mockTagsByKey.set('a.jpg', ['x'])
    mockTagsByKey.set('b.jpg', ['y'])
    const onSaved = vi.fn()
    render(
      <TagsModal
        tagStorageKeys={['a.jpg', 'b.jpg']}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    )

    const removeX = await screen.findByRole('button', { name: 'Remove tag x' })
    fireEvent.click(removeX)

    expect(mocks.setTags).toHaveBeenCalledWith('a.jpg', ['y'])
    expect(mocks.setTags).toHaveBeenCalledWith('b.jpg', ['y'])
    expect(onSaved).toHaveBeenCalledTimes(2)
  })

  it('shows the unsupported-extension notice when a key is not media', () => {
    mocks.isSupportedMediaFile.mockReturnValue(false)
    render(
      <TagsModal
        tagStorageKeys={['notes.txt']}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    )

    expect(screen.getByText(/not a supported extension/i)).toBeTruthy()
    expect(screen.queryByPlaceholderText('Add tags…')).toBeNull()
  })

  it('calls onClose from the Done button and the backdrop', () => {
    const onClose = vi.fn()
    render(
      <TagsModal
        tagStorageKeys={['photo.jpg']}
        onClose={onClose}
        onSaved={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('dialog', { name: 'Tags' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

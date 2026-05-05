/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetRecentTags = vi.hoisted(() =>
  vi.fn((): string[] => [])
)

vi.mock('../lib/recent-tags.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/recent-tags.ts')>()
  return {
    ...actual,
    getRecentTags: () => mockGetRecentTags(),
    recordTagApplied: vi.fn(),
    subscribeRecentTags: () => () => {},
  }
})

import { PreviewModal } from './PreviewModal.tsx'

function mockImageFileHandle(fileName: string): FileSystemFileHandle {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
  return {
    kind: 'file',
    name: fileName,
    getFile: async () => new File([blob], fileName, { type: 'image/jpeg' }),
  } as FileSystemFileHandle
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:test',
    revokeObjectURL: () => {},
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  mockGetRecentTags.mockReset()
  mockGetRecentTags.mockImplementation(() => [])
})

describe('PreviewModal', () => {
  it('shows the file name as heading and in the dialog accessible name', () => {
    const onClose = vi.fn()
    const onApply = vi.fn()
    render(
      <PreviewModal
        fileHandle={mockImageFileHandle('vacation.jpg')}
        kind="image"
        tagStorageKey="vacation.jpg"
        tags={[]}
        onApplyFrequentTag={onApply}
        onClose={onClose}
        fileSizeBytes={2048}
        fileName="vacation.jpg"
        saveDirectoryHandle={null}
      />
    )

    // Dialog now uses aria-labelledby pointing at the h2, so the accessible
    // name is the h2 text rather than the old "Preview: <filename>" prefix.
    expect(
      screen.getByRole('dialog', { name: 'vacation.jpg' })
    ).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'vacation.jpg' })).toBeTruthy()
  })

  it('shows More list with tags not in recent strip when allKnownTagNames is set', () => {
    mockGetRecentTags.mockReturnValue(['recent'])
    const onApply = vi.fn()
    render(
      <PreviewModal
        fileHandle={mockImageFileHandle('x.jpg')}
        kind="image"
        tagStorageKey="x.jpg"
        tags={[]}
        onApplyFrequentTag={onApply}
        onClose={vi.fn()}
        fileSizeBytes={100}
        fileName="x.jpg"
        saveDirectoryHandle={null}
        allKnownTagNames={['recent', 'alpha', 'beta']}
      />
    )

    expect(screen.getByText('Quick add')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'recent' })).toBeTruthy()
    const moreBtn = screen.getByRole('button', { name: /More/i })
    fireEvent.click(moreBtn)

    const alpha = screen.getByRole('option', { name: 'alpha' })
    expect(alpha).toBeTruthy()
    expect(screen.getByRole('option', { name: 'beta' })).toBeTruthy()

    fireEvent.click(alpha)
    expect(onApply).toHaveBeenCalledWith('alpha')
  })

  it('does not show More when no extra tags beyond visible recent strip', () => {
    mockGetRecentTags.mockReturnValue(['a', 'b'])
    render(
      <PreviewModal
        fileHandle={mockImageFileHandle('x.jpg')}
        kind="image"
        tagStorageKey="x.jpg"
        tags={[]}
        onApplyFrequentTag={vi.fn()}
        onClose={vi.fn()}
        fileSizeBytes={100}
        fileName="x.jpg"
        saveDirectoryHandle={null}
        allKnownTagNames={['a', 'b']}
      />
    )

    expect(screen.queryByRole('button', { name: /More/i })).toBeNull()
  })

  it('shows overflow recent tags only under More when strip is capped', () => {
    mockGetRecentTags.mockReturnValue(['r1', 'r2', 'r3', 'r4', 'r5'])
    const onApply = vi.fn()
    render(
      <PreviewModal
        fileHandle={mockImageFileHandle('x.jpg')}
        kind="image"
        tagStorageKey="x.jpg"
        tags={[]}
        onApplyFrequentTag={onApply}
        onClose={vi.fn()}
        fileSizeBytes={100}
        fileName="x.jpg"
        saveDirectoryHandle={null}
        allKnownTagNames={['r1', 'r2', 'r3', 'r4', 'r5']}
      />
    )

    expect(screen.queryByRole('button', { name: 'r5' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /More/i }))
    fireEvent.click(screen.getByRole('option', { name: 'r5' }))
    expect(onApply).toHaveBeenCalledWith('r5')
  })

  it('shows Quick add with New tag when there are no recents or More entries', () => {
    mockGetRecentTags.mockReturnValue([])
    render(
      <PreviewModal
        fileHandle={mockImageFileHandle('x.jpg')}
        kind="image"
        tagStorageKey="x.jpg"
        tags={[]}
        onApplyFrequentTag={vi.fn()}
        onClose={vi.fn()}
        fileSizeBytes={100}
        fileName="x.jpg"
        saveDirectoryHandle={null}
        allKnownTagNames={[]}
      />
    )

    expect(screen.getByText('Quick add')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New tag' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /More/i })).toBeNull()
  })

  it('opens new tag dialog and applies trimmed tag on Add', () => {
    mockGetRecentTags.mockReturnValue([])
    const onApply = vi.fn()
    render(
      <PreviewModal
        fileHandle={mockImageFileHandle('x.jpg')}
        kind="image"
        tagStorageKey="x.jpg"
        tags={[]}
        onApplyFrequentTag={onApply}
        onClose={vi.fn()}
        fileSizeBytes={100}
        fileName="x.jpg"
        saveDirectoryHandle={null}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'New tag' }))
    expect(screen.getByRole('dialog', { name: 'New tag' })).toBeTruthy()

    const input = screen.getByPlaceholderText('Tag name')
    fireEvent.input(input, { target: { value: '  fresh  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(onApply).toHaveBeenCalledWith('fresh')
  })
})

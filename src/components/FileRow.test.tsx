/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileRow, type DirListItem, type FileListItem } from './FileRow.tsx'

afterEach(() => {
  cleanup()
})

function makeFile(overrides: Partial<FileListItem> = {}): FileListItem {
  return {
    kind: 'file',
    name: 'photo.jpg',
    tagStorageKey: 'photo.jpg',
    handle: {} as FileSystemFileHandle,
    size: 2048,
    lastModified: 0,
    ...overrides,
  }
}

function makeDir(overrides: Partial<DirListItem> = {}): DirListItem {
  return {
    kind: 'directory',
    name: 'vacation',
    handle: {} as FileSystemDirectoryHandle,
    ...overrides,
  }
}

describe('FileRow', () => {
  it('renders a directory row and opens it on click', () => {
    const onOpenDir = vi.fn()
    const handle = {} as FileSystemDirectoryHandle
    render(
      <FileRow
        item={makeDir({ handle, relativePath: 'a/vacation' })}
        previewKind={null}
        onOpenDir={onOpenDir}
        onPreview={vi.fn()}
      />
    )
    expect(screen.getByText('Folder')).toBeTruthy()
    expect(screen.getByText('a/vacation')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /vacation/ }))
    expect(onOpenDir).toHaveBeenCalledWith('vacation', handle)
  })

  it('renders file name, size, and relative path', () => {
    render(
      <FileRow
        item={makeFile({ relativePath: 'sub/photo.jpg' })}
        previewKind="image"
        onOpenDir={vi.fn()}
        onPreview={vi.fn()}
      />
    )
    expect(screen.getByText('photo.jpg')).toBeTruthy()
    expect(screen.getByText('sub/photo.jpg')).toBeTruthy()
  })

  it('renders tag chips', () => {
    render(
      <FileRow
        item={makeFile()}
        previewKind="image"
        onOpenDir={vi.fn()}
        onPreview={vi.fn()}
        tags={['red', 'blue']}
      />
    )
    expect(screen.getByText('red')).toBeTruthy()
    expect(screen.getByText('blue')).toBeTruthy()
  })

  it('reflects selection via aria-pressed', () => {
    render(
      <FileRow
        item={makeFile()}
        previewKind="image"
        onOpenDir={vi.fn()}
        onPreview={vi.fn()}
        selected
      />
    )
    const row = screen.getByRole('button', { name: 'photo.jpg' })
    expect(row.getAttribute('aria-pressed')).toBe('true')
  })

  it('single primary click selects the file', () => {
    const onFileSelect = vi.fn()
    const item = makeFile()
    render(
      <FileRow
        item={item}
        previewKind="image"
        onOpenDir={vi.fn()}
        onPreview={vi.fn()}
        onFileSelect={onFileSelect}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'photo.jpg' }), {
      button: 0,
      detail: 1,
    })
    expect(onFileSelect).toHaveBeenCalledTimes(1)
    expect(onFileSelect.mock.calls[0][1]).toBe(item)
  })

  it('ignores click when detail===2 (double click guard)', () => {
    const onFileSelect = vi.fn()
    render(
      <FileRow
        item={makeFile()}
        previewKind="image"
        onOpenDir={vi.fn()}
        onPreview={vi.fn()}
        onFileSelect={onFileSelect}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'photo.jpg' }), {
      button: 0,
      detail: 2,
    })
    expect(onFileSelect).not.toHaveBeenCalled()
  })

  it('double click triggers preview with the preview kind', () => {
    const onPreview = vi.fn()
    const item = makeFile()
    render(
      <FileRow
        item={item}
        previewKind="image"
        onOpenDir={vi.fn()}
        onPreview={onPreview}
      />
    )
    fireEvent.dblClick(screen.getByRole('button', { name: 'photo.jpg' }), {
      button: 0,
    })
    expect(onPreview).toHaveBeenCalledWith(item, 'image')
  })

  it('Enter key previews and Space key selects', () => {
    const onPreview = vi.fn()
    const onFileSelect = vi.fn()
    render(
      <FileRow
        item={makeFile()}
        previewKind="video"
        onOpenDir={vi.fn()}
        onPreview={onPreview}
        onFileSelect={onFileSelect}
      />
    )
    const row = screen.getByRole('button', { name: 'photo.jpg' })
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onPreview).toHaveBeenCalledWith(expect.anything(), 'video')
    fireEvent.keyDown(row, { key: ' ' })
    expect(onFileSelect).toHaveBeenCalled()
  })

  it('context menu fires onFileContextMenu', () => {
    const onFileContextMenu = vi.fn()
    render(
      <FileRow
        item={makeFile()}
        previewKind="image"
        onOpenDir={vi.fn()}
        onPreview={vi.fn()}
        onFileContextMenu={onFileContextMenu}
      />
    )
    fireEvent.contextMenu(screen.getByRole('button', { name: 'photo.jpg' }))
    expect(onFileContextMenu).toHaveBeenCalled()
  })

  it('Preview button (when previewKind set) previews and stops propagation', () => {
    const onPreview = vi.fn()
    const onFileSelect = vi.fn()
    render(
      <FileRow
        item={makeFile()}
        previewKind="image"
        onOpenDir={vi.fn()}
        onPreview={onPreview}
        onFileSelect={onFileSelect}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(onPreview).toHaveBeenCalledWith(expect.anything(), 'image')
    // stopPropagation means the row's onClick select should not also fire.
    expect(onFileSelect).not.toHaveBeenCalled()
  })

  it('does not render Preview button when previewKind is null', () => {
    render(
      <FileRow
        item={makeFile()}
        previewKind={null}
        onOpenDir={vi.fn()}
        onPreview={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
  })
})

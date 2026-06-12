/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FileThumbnail,
  FolderThumbnail,
} from './FileThumbnail.tsx'
import type { DirListItem, FileListItem } from './FileRow.tsx'

function makeFile(overrides: Partial<FileListItem> = {}): FileListItem {
  const getFile = vi.fn(
    async () => new File([new Uint8Array([1, 2, 3])], 'img.jpg', { type: 'image/jpeg' })
  )
  return {
    kind: 'file',
    name: 'img.jpg',
    tagStorageKey: 'img.jpg',
    handle: { getFile } as unknown as FileSystemFileHandle,
    size: 1024,
    lastModified: 0,
    ...overrides,
  }
}

beforeEach(() => {
  // IntersectionObserver that immediately reports the element as intersecting.
  class IO {
    cb: IntersectionObserverCallback
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb
    }
    observe(el: Element) {
      this.cb(
        [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver
      )
    }
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', IO)

  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
    width: 320,
    height: 240,
    close: vi.fn(),
  })))

  class OC {
    width: number
    height: number
    constructor(w: number, h: number) {
      this.width = w
      this.height = h
    }
    getContext() {
      return { drawImage: vi.fn() }
    }
    async convertToBlob() {
      return new Blob([new Uint8Array([9])], { type: 'image/jpeg' })
    }
  }
  vi.stubGlobal('OffscreenCanvas', OC)

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:thumb'),
    revokeObjectURL: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('FileThumbnail', () => {
  it('renders an image thumbnail once the blob URL resolves', async () => {
    render(
      <FileThumbnail
        item={makeFile()}
        tags={[]}
        previewKind="image"
        selected={false}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onContextMenu={vi.fn()}
      />
    )
    await waitFor(() => {
      const img = screen.getByAltText('img.jpg') as HTMLImageElement
      expect(img.getAttribute('src')).toBe('blob:thumb')
    })
  })

  it('renders the video placeholder for video kind', () => {
    render(
      <FileThumbnail
        item={makeFile({ name: 'clip.mp4' })}
        tags={[]}
        previewKind="video"
        selected={false}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onContextMenu={vi.fn()}
      />
    )
    expect(screen.getByText('Video')).toBeTruthy()
  })

  it('renders the generic file placeholder when previewKind is null', () => {
    render(
      <FileThumbnail
        item={makeFile({ name: 'notes.txt' })}
        tags={[]}
        previewKind={null}
        selected={false}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onContextMenu={vi.fn()}
      />
    )
    expect(screen.getByText('File')).toBeTruthy()
  })

  it('shows a selection check mark and aria-pressed when selected', () => {
    render(
      <FileThumbnail
        item={makeFile()}
        tags={[]}
        previewKind="video"
        selected
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onContextMenu={vi.fn()}
      />
    )
    const card = screen.getByRole('button', { name: 'img.jpg' })
    expect(card.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('✓')).toBeTruthy()
  })

  it('renders up to three tags plus an overflow count', () => {
    render(
      <FileThumbnail
        item={makeFile()}
        tags={['a', 'b', 'c', 'd', 'e']}
        previewKind="video"
        selected={false}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onContextMenu={vi.fn()}
      />
    )
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('c')).toBeTruthy()
    expect(screen.queryByText('d')).toBeNull()
    expect(screen.getByText('+2')).toBeTruthy()
  })

  it('single click selects, double click previews', () => {
    const onSelect = vi.fn()
    const onPreview = vi.fn()
    render(
      <FileThumbnail
        item={makeFile()}
        tags={[]}
        previewKind="video"
        selected={false}
        onSelect={onSelect}
        onPreview={onPreview}
        onContextMenu={vi.fn()}
      />
    )
    const card = screen.getByRole('button', { name: 'img.jpg' })
    fireEvent.click(card, { button: 0, detail: 1 })
    expect(onSelect).toHaveBeenCalled()
    fireEvent.dblClick(card, { button: 0 })
    expect(onPreview).toHaveBeenCalledWith(expect.anything(), 'video')
  })

  it('Preview button calls onPreview and stops propagation', () => {
    const onSelect = vi.fn()
    const onPreview = vi.fn()
    render(
      <FileThumbnail
        item={makeFile()}
        tags={[]}
        previewKind="video"
        selected={false}
        onSelect={onSelect}
        onPreview={onPreview}
        onContextMenu={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(onPreview).toHaveBeenCalledWith(expect.anything(), 'video')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Enter previews, Space selects, context menu fires', () => {
    const onSelect = vi.fn()
    const onPreview = vi.fn()
    const onContextMenu = vi.fn()
    render(
      <FileThumbnail
        item={makeFile()}
        tags={[]}
        previewKind="video"
        selected={false}
        onSelect={onSelect}
        onPreview={onPreview}
        onContextMenu={onContextMenu}
      />
    )
    const card = screen.getByRole('button', { name: 'img.jpg' })
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onPreview).toHaveBeenCalled()
    fireEvent.keyDown(card, { key: ' ' })
    expect(onSelect).toHaveBeenCalled()
    fireEvent.contextMenu(card)
    expect(onContextMenu).toHaveBeenCalled()
  })
})

describe('FolderThumbnail', () => {
  function makeDir(overrides: Partial<DirListItem> = {}): DirListItem {
    return {
      kind: 'directory',
      name: 'photos',
      handle: {} as FileSystemDirectoryHandle,
      ...overrides,
    }
  }

  it('renders folder name and relative path and opens on click', () => {
    const onOpen = vi.fn()
    const handle = {} as FileSystemDirectoryHandle
    render(
      <FolderThumbnail
        item={makeDir({ handle, relativePath: 'a/photos' })}
        onOpen={onOpen}
      />
    )
    expect(screen.getByText('photos')).toBeTruthy()
    expect(screen.getByText('a/photos')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /photos/ }))
    expect(onOpen).toHaveBeenCalledWith('photos', handle)
  })
})

/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockBlobUrl = vi.hoisted(() => ({ url: 'blob:viewer' as string | null }))

vi.mock('../lib/use-blob-url', () => ({
  useFileBlobURL: () => ({ url: mockBlobUrl.url, error: null }),
}))

vi.mock('../lib/video-ab-loop.ts', () => ({
  useVideoABLoop: vi.fn(),
  VIDEO_AB_LOOP_EPS: 0.04,
}))

import { ViewerPane, type ViewerPaneItem } from './ViewerPane.tsx'

function imageItem(id: string, name = 'a.jpg'): ViewerPaneItem {
  return { id, name, handle: {} as FileSystemFileHandle, kind: 'image' }
}

function videoItem(id: string, name = 'a.mp4'): ViewerPaneItem {
  return { id, name, handle: {} as FileSystemFileHandle, kind: 'video' }
}

beforeEach(() => {
  mockBlobUrl.url = 'blob:viewer'
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ViewerPane', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(
      <ViewerPane items={[]} onRemove={vi.fn()} onClear={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the viewer with the item count', () => {
    render(
      <ViewerPane
        items={[imageItem('1'), imageItem('2', 'b.jpg')]}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Viewer pane')).toBeTruthy()
    expect(screen.getByText('(2)')).toBeTruthy()
  })

  it('renders an img element for image items wired to the blob URL', () => {
    const { container } = render(
      <ViewerPane items={[imageItem('1')]} onRemove={vi.fn()} onClear={vi.fn()} />
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('blob:viewer')
  })

  it('renders a video element for video items with loop attribute when no loopRange', () => {
    render(
      <ViewerPane items={[videoItem('1')]} onRemove={vi.fn()} onClear={vi.fn()} />
    )
    const video = screen.getByLabelText('a.mp4') as HTMLVideoElement
    expect(video.tagName).toBe('VIDEO')
    expect(video.hasAttribute('loop')).toBe(true)
  })

  it('does not set loop attribute when a loopRange is provided', () => {
    const item: ViewerPaneItem = {
      ...videoItem('1'),
      loopRange: { startSec: 1, endSec: 2 },
    }
    render(<ViewerPane items={[item]} onRemove={vi.fn()} onClear={vi.fn()} />)
    const video = screen.getByLabelText('a.mp4') as HTMLVideoElement
    expect(video.hasAttribute('loop')).toBe(false)
  })

  it('shows a loading placeholder when the blob URL is null', () => {
    mockBlobUrl.url = null
    render(
      <ViewerPane items={[imageItem('1')]} onRemove={vi.fn()} onClear={vi.fn()} />
    )
    expect(screen.getByText('…')).toBeTruthy()
  })

  it('remove button calls onRemove with the item id', () => {
    const onRemove = vi.fn()
    render(
      <ViewerPane
        items={[imageItem('item-1')]}
        onRemove={onRemove}
        onClear={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText('Remove a.jpg from viewer'))
    expect(onRemove).toHaveBeenCalledWith('item-1')
  })

  it('Clear button calls onClear', () => {
    const onClear = vi.fn()
    render(
      <ViewerPane items={[imageItem('1')]} onRemove={vi.fn()} onClear={onClear} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('toggles between Fill and Dock when the expand button is clicked', () => {
    render(
      <ViewerPane items={[imageItem('1')]} onRemove={vi.fn()} onClear={vi.fn()} />
    )
    const toggle = screen.getByRole('button', { name: 'Fill' })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Dock' })).toBeTruthy()
    expect(screen.getByText('Esc or Dock to exit')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dock' }))
    expect(screen.getByRole('button', { name: 'Fill' })).toBeTruthy()
  })
})

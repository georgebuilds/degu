/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileContextMenu } from './FileContextMenu.tsx'

afterEach(() => {
  cleanup()
})

describe('FileContextMenu', () => {
  it('renders a menu role with its children', () => {
    render(
      <FileContextMenu x={10} y={20} onClose={vi.fn()}>
        <button type="button">Edit tags</button>
      </FileContextMenu>
    )
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit tags' })).toBeTruthy()
  })

  it('invokes menu-item callbacks when clicked', () => {
    const onItem = vi.fn()
    render(
      <FileContextMenu x={0} y={0} onClose={vi.fn()}>
        <button type="button" onClick={onItem}>
          Open
        </button>
      </FileContextMenu>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(onItem).toHaveBeenCalled()
  })

  it('positions itself via inline left/top styles after layout', () => {
    render(
      <FileContextMenu x={30} y={40} onClose={vi.fn()}>
        <span>item</span>
      </FileContextMenu>
    )
    const menu = screen.getByRole('menu') as HTMLElement
    // useLayoutEffect clamps within viewport; with 0-size rect in happy-dom the
    // requested coords survive (within padding).
    expect(menu.style.left).toBe('30px')
    expect(menu.style.top).toBe('40px')
  })

  it('clamps position to padding when negative coords are requested', () => {
    render(
      <FileContextMenu x={-100} y={-100} onClose={vi.fn()}>
        <span>item</span>
      </FileContextMenu>
    )
    const menu = screen.getByRole('menu') as HTMLElement
    expect(menu.style.left).toBe('8px')
    expect(menu.style.top).toBe('8px')
  })

  it('calls onClose on outside mousedown but not on inside mousedown', () => {
    const onClose = vi.fn()
    render(
      <FileContextMenu x={0} y={0} onClose={onClose}>
        <button type="button">Inside</button>
      </FileContextMenu>
    )
    // Inside click should not close.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inside' }))
    expect(onClose).not.toHaveBeenCalled()
    // Outside click closes.
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(
      <FileContextMenu x={0} y={0} onClose={onClose}>
        <span>item</span>
      </FileContextMenu>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

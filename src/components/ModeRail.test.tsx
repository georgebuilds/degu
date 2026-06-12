/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModeRail } from './ModeRail.tsx'

afterEach(() => {
  cleanup()
})

describe('ModeRail', () => {
  it('renders all mode buttons and the root folder name', () => {
    render(
      <ModeRail
        mode="triage"
        onModeChange={vi.fn()}
        rootFolderName="my-folder"
        onOpenSettings={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /^Triage/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Library/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Tags/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^People/i })).toBeTruthy()
    expect(screen.getByText('my-folder')).toBeTruthy()
  })

  it('marks the active mode with aria-current="page"', () => {
    render(
      <ModeRail
        mode="library"
        onModeChange={vi.fn()}
        rootFolderName="root"
        onOpenSettings={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: /^Library/i }).getAttribute('aria-current')
    ).toBe('page')
    expect(
      screen.getByRole('button', { name: /^Triage/i }).getAttribute('aria-current')
    ).toBeNull()
  })

  it('calls onModeChange with the chosen mode', () => {
    const onModeChange = vi.fn()
    render(
      <ModeRail
        mode="triage"
        onModeChange={onModeChange}
        rootFolderName="root"
        onOpenSettings={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Tags/i }))
    expect(onModeChange).toHaveBeenCalledWith('tags')
    fireEvent.click(screen.getByRole('button', { name: /^People/i }))
    expect(onModeChange).toHaveBeenCalledWith('people')
  })

  it('calls onOpenSettings when the settings button is clicked', () => {
    const onOpenSettings = vi.fn()
    render(
      <ModeRail
        mode="triage"
        onModeChange={vi.fn()}
        rootFolderName="root"
        onOpenSettings={onOpenSettings}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onOpenSettings).toHaveBeenCalled()
  })
})

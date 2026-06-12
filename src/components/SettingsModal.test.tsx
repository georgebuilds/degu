/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadDefaultStartMode: vi.fn((): string => 'triage'),
  saveDefaultStartMode: vi.fn(),
  isIntroDismissed: vi.fn((): boolean => false),
  dismissIntro: vi.fn(),
}))

vi.mock('../lib/settings', () => ({
  loadDefaultStartMode: () => mocks.loadDefaultStartMode(),
  saveDefaultStartMode: (m: string) => mocks.saveDefaultStartMode(m),
  isIntroDismissed: () => mocks.isIntroDismissed(),
  dismissIntro: () => mocks.dismissIntro(),
}))

import { SettingsModal } from './SettingsModal.tsx'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.loadDefaultStartMode.mockReturnValue('triage')
  mocks.isIntroDismissed.mockReturnValue(false)
})

describe('SettingsModal', () => {
  it('renders the dialog with all mode choices and marks the loaded default as checked', () => {
    mocks.loadDefaultStartMode.mockReturnValue('library')
    render(<SettingsModal onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
    for (const label of ['Triage', 'Library', 'Tags', 'People']) {
      expect(screen.getByRole('radio', { name: new RegExp(label) })).toBeTruthy()
    }
    expect(
      screen.getByRole('radio', { name: /Library/ }).getAttribute('aria-checked')
    ).toBe('true')
  })

  it('selecting a mode saves it and dismisses the intro when not already dismissed', () => {
    render(<SettingsModal onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: /People/ }))

    expect(mocks.saveDefaultStartMode).toHaveBeenCalledWith('people')
    expect(mocks.dismissIntro).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('radio', { name: /People/ }).getAttribute('aria-checked')
    ).toBe('true')
  })

  it('does not dismiss the intro again when it is already dismissed', () => {
    mocks.isIntroDismissed.mockReturnValue(true)
    render(<SettingsModal onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: /Tags/ }))

    expect(mocks.saveDefaultStartMode).toHaveBeenCalledWith('tags')
    expect(mocks.dismissIntro).not.toHaveBeenCalled()
  })

  it('calls onClose from the close button', () => {
    const onClose = vi.fn()
    render(<SettingsModal onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the backdrop is clicked but not when the panel is clicked', () => {
    const onClose = vi.fn()
    render(<SettingsModal onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    // Click on the panel (a child) — should not close.
    fireEvent.click(screen.getByRole('heading', { name: 'Settings' }))
    expect(onClose).not.toHaveBeenCalled()

    // Click directly on the backdrop element.
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

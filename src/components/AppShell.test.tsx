/** @vitest-environment happy-dom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppMode } from './ModeRail.tsx'

const mockSettings = vi.hoisted(() => ({
  startMode: 'triage' as AppMode,
  introDismissed: false,
  introListeners: new Set<() => void>(),
}))

vi.mock('../lib/settings', () => ({
  loadDefaultStartMode: () => mockSettings.startMode,
  isIntroDismissed: () => mockSettings.introDismissed,
  subscribeIntroDismissed: (fn: () => void) => {
    mockSettings.introListeners.add(fn)
    return () => {
      mockSettings.introListeners.delete(fn)
    }
  },
}))

vi.mock('./TriageScreen.tsx', () => ({
  TriageScreen: () => <div data-testid="triage-screen" />,
}))
vi.mock('./FileBrowser.tsx', () => ({
  FileBrowser: () => <div data-testid="file-browser" />,
}))
vi.mock('./PeopleScreen.tsx', () => ({
  PeopleScreen: () => <div data-testid="people-screen" />,
}))
vi.mock('./TagsScreen.tsx', () => ({
  TagsScreen: () => <div data-testid="tags-screen" />,
}))
vi.mock('./SettingsModal.tsx', () => ({
  SettingsModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="settings-modal">
      <button type="button" onClick={onClose}>
        close-settings
      </button>
    </div>
  ),
}))

import { AppShell } from './AppShell.tsx'

const rootHandle = { name: 'photos' } as unknown as FileSystemDirectoryHandle

beforeEach(() => {
  mockSettings.startMode = 'triage'
  mockSettings.introDismissed = false
  mockSettings.introListeners.clear()
})

afterEach(() => {
  cleanup()
})

describe('AppShell', () => {
  it('renders the mode rail and the default start screen (triage)', () => {
    render(<AppShell rootHandle={rootHandle} />)
    expect(screen.getByTestId('triage-screen')).toBeTruthy()
    expect(screen.getByText('photos')).toBeTruthy()
  })

  it('honors a non-default start mode from settings', () => {
    mockSettings.startMode = 'library'
    render(<AppShell rootHandle={rootHandle} />)
    expect(screen.getByTestId('file-browser')).toBeTruthy()
  })

  it('switches screens when a rail button is clicked', () => {
    render(<AppShell rootHandle={rootHandle} />)
    fireEvent.click(screen.getByRole('button', { name: /^Tags/i }))
    expect(screen.getByTestId('tags-screen')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^People/i }))
    expect(screen.getByTestId('people-screen')).toBeTruthy()
  })

  it('shows the intro ribbon when not dismissed and hides it after dismiss', () => {
    render(<AppShell rootHandle={rootHandle} />)
    expect(screen.getByRole('status')).toBeTruthy()
    // Simulate the intro being dismissed and the subscription firing.
    mockSettings.introDismissed = true
    act(() => {
      for (const fn of mockSettings.introListeners) fn()
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does not show the intro ribbon when already dismissed', () => {
    mockSettings.introDismissed = true
    render(<AppShell rootHandle={rootHandle} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('opens and closes the settings modal', () => {
    // Dismiss the intro so its "Settings" link doesn't collide with the
    // mode rail's "Settings" button in the accessible-name query.
    mockSettings.introDismissed = true
    render(<AppShell rootHandle={rootHandle} />)
    expect(screen.queryByTestId('settings-modal')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByTestId('settings-modal')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'close-settings' }))
    expect(screen.queryByTestId('settings-modal')).toBeNull()
  })
})

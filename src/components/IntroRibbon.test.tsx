/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockDismissIntro = vi.hoisted(() => vi.fn())

vi.mock('../lib/settings', () => ({
  dismissIntro: () => mockDismissIntro(),
}))

import { IntroRibbon } from './IntroRibbon.tsx'

afterEach(() => {
  cleanup()
  mockDismissIntro.mockReset()
})

describe('IntroRibbon', () => {
  it('renders the status message with a Settings link', () => {
    render(<IntroRibbon onOpenSettings={vi.fn()} />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
  })

  it('calls onOpenSettings when the Settings link is clicked', () => {
    const onOpenSettings = vi.fn()
    render(<IntroRibbon onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('calls dismissIntro when the dismiss button is clicked', () => {
    render(<IntroRibbon onOpenSettings={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(mockDismissIntro).toHaveBeenCalled()
  })
})

/** @vitest-environment happy-dom */

import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgressBar } from './ProgressBar.tsx'

afterEach(() => {
  cleanup()
})

describe('ProgressBar', () => {
  it('renders a determinate bar with aria-valuenow', () => {
    render(<ProgressBar percent={42} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('42')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    const fill = bar.querySelector('div') as HTMLDivElement
    expect(fill.style.width).toBe('42%')
  })

  it('clamps percent above 100', () => {
    render(<ProgressBar percent={150} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '100'
    )
  })

  it('clamps percent below 0', () => {
    render(<ProgressBar percent={-20} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '0'
    )
  })

  it('rounds fractional percents for aria-valuenow', () => {
    render(<ProgressBar percent={33.6} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '34'
    )
  })

  it('renders an indeterminate bar with aria-valuetext', () => {
    render(<ProgressBar indeterminate />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuetext')).toBe('In progress')
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
  })

  it('applies a custom class to the track', () => {
    render(<ProgressBar percent={10} class="my-track" />)
    expect(screen.getByRole('progressbar').className).toContain('my-track')
  })
})

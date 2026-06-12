/** @vitest-environment happy-dom */

import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { Burroughs } from './Burroughs.tsx'

afterEach(() => {
  cleanup()
})

describe('Burroughs', () => {
  it('renders with an accessible label', () => {
    render(<Burroughs />)
    expect(screen.getByRole('img', { name: 'Burroughs the degu' })).toBeTruthy()
  })

  it('shows the check badge in the sorted state', () => {
    const { container } = render(<Burroughs state="sorted" />)
    // The "sorted" check badge is a green circle at cx=170.
    const badge = container.querySelector('circle[cx="170"]')
    expect(badge).toBeTruthy()
  })

  it('omits the check badge in the idle state', () => {
    const { container } = render(<Burroughs state="idle" />)
    expect(container.querySelector('circle[cx="170"]')).toBeNull()
  })

  it('honors a custom size', () => {
    const { container } = render(<Burroughs size={80} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('80')
    expect(svg?.getAttribute('height')).toBe('80')
  })
})

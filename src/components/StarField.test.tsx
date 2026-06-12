/** @vitest-environment happy-dom */

import { cleanup, render } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { StarField } from './StarField.tsx'

afterEach(() => {
  cleanup()
})

describe('StarField', () => {
  it('renders an aria-hidden svg and populates it with the default density', () => {
    const { container } = render(<StarField />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.querySelectorAll('circle').length).toBe(90)
  })

  it('honors a custom density', () => {
    const { container } = render(<StarField density={12} />)
    expect(container.querySelector('svg')?.querySelectorAll('circle').length).toBe(
      12
    )
  })

  it('appends the provided class to the svg', () => {
    const { container } = render(<StarField density={1} class="extra-cls" />)
    expect(container.querySelector('svg')?.getAttribute('class')).toContain(
      'extra-cls'
    )
  })

  it('does not re-populate if the svg already has children', () => {
    const { container, rerender } = render(<StarField density={5} />)
    rerender(<StarField density={5} />)
    expect(container.querySelector('svg')?.querySelectorAll('circle').length).toBe(
      5
    )
  })
})

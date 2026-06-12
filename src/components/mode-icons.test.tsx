/** @vitest-environment happy-dom */

import { cleanup, render } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LibraryIcon,
  PeopleIcon,
  TagsIcon,
  TriageIcon,
} from './mode-icons.tsx'

afterEach(() => {
  cleanup()
})

describe('mode-icons', () => {
  it('renders each icon as an svg with the default size', () => {
    for (const Icon of [TriageIcon, LibraryIcon, PeopleIcon, TagsIcon]) {
      const { container, unmount } = render(<Icon />)
      const svg = container.querySelector('svg')
      expect(svg).toBeTruthy()
      expect(svg?.getAttribute('width')).toBe('18')
      expect(svg?.getAttribute('height')).toBe('18')
      unmount()
    }
  })

  it('honors a custom size prop', () => {
    const { container } = render(<TriageIcon size={32} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('32')
    expect(svg?.getAttribute('height')).toBe('32')
  })
})

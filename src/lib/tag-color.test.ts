import { describe, expect, it } from 'vitest'
import { BURROW_TAG_HUES, tagColor } from './tag-color'

describe('tagColor', () => {
  it('returns one of the Burrow tag hues', () => {
    const c = tagColor('family')
    expect(BURROW_TAG_HUES).toContain(c as (typeof BURROW_TAG_HUES)[number])
  })

  it('is deterministic for the same tag', () => {
    expect(tagColor('sunset')).toBe(tagColor('sunset'))
    expect(tagColor('travel')).toBe(tagColor('travel'))
  })

  it('returns a defined hue for the empty string', () => {
    expect(BURROW_TAG_HUES).toContain(
      tagColor('') as (typeof BURROW_TAG_HUES)[number]
    )
  })
})

/**
 * Hash a tag name to one of the eight Burrow tag hues. Same name → same hue,
 * always — so a tag has a recognizable shape in the user's peripheral vision.
 */

export const BURROW_TAG_HUES = [
  '#8FA67A', // sage
  '#C9774E', // clay
  '#C18B91', // rose
  '#7C8A95', // slate
  '#D4A24C', // ochre
  '#9B7C9E', // plum
  '#7C9070', // fern
  '#A38872', // cocoa
] as const

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

export function tagColor(tag: string): string {
  let h = FNV_OFFSET
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i)
    h = Math.imul(h, FNV_PRIME) >>> 0
  }
  return BURROW_TAG_HUES[h % BURROW_TAG_HUES.length]!
}

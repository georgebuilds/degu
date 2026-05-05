/**
 * Supported media for listings, tags, search, and previews. Tree enumeration
 * still walks every directory entry; we skip per-file work for anything else.
 *
 * GIF is grouped with **images** (rendered with `<img>`; animation loops in the browser).
 */

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mov',
  'mkv',
  'avi',
])

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'svg',
  'avif',
  'gif',
])

export function fileExtension(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i > 0 ? filename.slice(i + 1).toLowerCase() : ''
}

export function isSupportedVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(fileExtension(filename))
}

export function isSupportedImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(filename))
}

/** Video or image (including GIF). */
export function isSupportedMediaFile(filename: string): boolean {
  return isSupportedVideoFile(filename) || isSupportedImageFile(filename)
}

/** Sidebar filter: show only images, only videos, or all supported media. */
export type MediaKindFilter = 'images' | 'videos' | 'both'

export function passesMediaKindFilter(
  filename: string,
  filter: MediaKindFilter
): boolean {
  if (filter === 'both') return true
  if (filter === 'images') return isSupportedImageFile(filename)
  return isSupportedVideoFile(filename)
}

/** Last path segment; `rel` uses `/` separators. */
export function basenameFromRelativePath(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i === -1 ? rel : rel.slice(i + 1)
}

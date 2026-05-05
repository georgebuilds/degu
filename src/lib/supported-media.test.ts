import { describe, expect, it } from 'vitest'
import { getPreviewKind } from './preview'
import {
  basenameFromRelativePath,
  fileExtension,
  isSupportedImageFile,
  isSupportedMediaFile,
  isSupportedVideoFile,
  passesMediaKindFilter,
} from './supported-media'

describe('fileExtension', () => {
  it('returns lowercased extension', () => {
    expect(fileExtension('Photo.JPG')).toBe('jpg')
  })

  it('uses last segment after dots, empty for no-dot names', () => {
    expect(fileExtension('README')).toBe('')
    expect(fileExtension('archive.tar.gz')).toBe('gz')
  })

  it('returns empty string for dotless filename like gif', () => {
    expect(fileExtension('gif')).toBe('')
  })

  it('returns empty string for dot-prefixed hidden files', () => {
    expect(fileExtension('.gitignore')).toBe('')
  })

  it('returns lowercased extension for multi-dot names', () => {
    expect(fileExtension('a.b.JPG')).toBe('jpg')
  })
})

describe('isSupportedImageFile / isSupportedVideoFile', () => {
  it('treats gif as image', () => {
    expect(isSupportedImageFile('a.gif')).toBe(true)
    expect(isSupportedVideoFile('a.gif')).toBe(false)
  })

  it('recognizes common video extensions', () => {
    expect(isSupportedVideoFile('x.mp4')).toBe(true)
    expect(isSupportedImageFile('x.mp4')).toBe(false)
  })
})

describe('isSupportedMediaFile', () => {
  it('is true for image or video', () => {
    expect(isSupportedMediaFile('a.png')).toBe(true)
    expect(isSupportedMediaFile('a.mkv')).toBe(true)
    expect(isSupportedMediaFile('a.exe')).toBe(false)
  })

  it('returns false for dotless names that look like extensions', () => {
    expect(isSupportedMediaFile('gif')).toBe(false)
    expect(isSupportedMediaFile('mp4')).toBe(false)
  })

  it('returns false for dot-prefixed hidden files', () => {
    expect(isSupportedMediaFile('.gitignore')).toBe(false)
  })
})

describe('passesMediaKindFilter', () => {
  it('both passes everything', () => {
    expect(passesMediaKindFilter('a.png', 'both')).toBe(true)
    expect(passesMediaKindFilter('a.mp4', 'both')).toBe(true)
  })

  it('images vs videos', () => {
    expect(passesMediaKindFilter('a.png', 'images')).toBe(true)
    expect(passesMediaKindFilter('a.mp4', 'images')).toBe(false)
    expect(passesMediaKindFilter('a.mp4', 'videos')).toBe(true)
  })
})

describe('getPreviewKind', () => {
  it('prefers video when both could match (video wins first)', () => {
    expect(getPreviewKind('x.mp4')).toBe('video')
  })

  it('returns image for supported images', () => {
    expect(getPreviewKind('a.webp')).toBe('image')
  })

  it('returns null for unsupported', () => {
    expect(getPreviewKind('notes.txt')).toBeNull()
  })
})

describe('basenameFromRelativePath', () => {
  it('returns last segment', () => {
    expect(basenameFromRelativePath('a/b/c.png')).toBe('c.png')
  })

  it('handles no slash', () => {
    expect(basenameFromRelativePath('only.jpg')).toBe('only.jpg')
  })
})

import { isSupportedImageFile, isSupportedVideoFile } from './supported-media'

export type PreviewKind = 'image' | 'video'

export function getPreviewKind(filename: string): PreviewKind | null {
  if (isSupportedVideoFile(filename)) return 'video'
  if (isSupportedImageFile(filename)) return 'image'
  return null
}

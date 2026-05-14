import { MAX_TRIM_INPUT_BYTES } from './video-trim-scope.ts'
import { getLoadedFFmpeg } from './ffmpeg-trim.ts'
import type { ProgressEventCallback } from '@ffmpeg/ffmpeg'

/**
 * One metadata field for the "modify" path. ffmpeg accepts `-metadata key=value`
 * for the global container; `key` is one of the well-known tags below.
 */
export type MetadataField = { key: string; value: string }

/**
 * What to do to one file's metadata.
 *
 * `strip` — `-map_metadata -1 -c copy`, removes every container tag.
 *
 * `modify` — write listed fields via `-metadata key=value -c copy`. Existing
 * tags not in `fields` are preserved; matching tags are overwritten.
 */
export type ScrubAction =
  | { mode: 'strip' }
  | { mode: 'modify'; fields: MetadataField[] }

/** Size cap. Inherits the trim cap (~512 MiB) so the in-memory wasm fs doesn't OOM. */
export const MAX_SCRUB_INPUT_BYTES = MAX_TRIM_INPUT_BYTES

/**
 * Stream-copy modes — preserves codec data, so output is bit-identical to input
 * except for the container metadata. No re-encoding, no quality loss, fast.
 *
 * Caller must check `file.size <= MAX_SCRUB_INPUT_BYTES` before invoking.
 */
export async function scrubFileWithFFmpeg(options: {
  file: File
  action: ScrubAction
  signal?: AbortSignal
  onProgress?: (ratio: number) => void
}): Promise<Uint8Array> {
  const { file, action, signal, onProgress } = options
  if (file.size > MAX_SCRUB_INPUT_BYTES) {
    throw new Error(
      `File is too large to scrub in the browser (max ${MAX_SCRUB_INPUT_BYTES / (1024 * 1024)} MB).`
    )
  }

  const dot = file.name.lastIndexOf('.')
  const ext = dot >= 0 ? file.name.slice(dot) : ''
  const tag = Math.random().toString(36).slice(2, 10)
  const inputName = `scrub_in_${tag}${ext}`
  const outputName = `scrub_out_${tag}${ext}`

  const ffmpeg = await getLoadedFFmpeg(signal)

  const onFfmpegProgress: ProgressEventCallback = ({ progress }) => {
    if (typeof progress === 'number' && onProgress) onProgress(progress)
  }
  if (onProgress) ffmpeg.on('progress', onFfmpegProgress)

  const args = buildFFmpegScrubArgs(action, inputName, outputName)

  const { fetchFile } = await import('@ffmpeg/util')
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file), { signal })
    const code = await ffmpeg.exec(args, undefined, { signal })
    if (code !== 0) {
      throw new Error(`ffmpeg failed (exit ${String(code)})`)
    }
    const data = await ffmpeg.readFile(outputName, undefined, { signal })
    if (data instanceof Uint8Array) {
      if (data.byteLength === 0) {
        throw new Error('ffmpeg produced empty output')
      }
      return data
    }
    throw new Error('Unexpected ffmpeg output')
  } finally {
    if (onProgress) ffmpeg.off('progress', onFfmpegProgress)
    if (ffmpeg.loaded) {
      await ffmpeg.deleteFile(inputName).catch(() => {})
      await ffmpeg.deleteFile(outputName).catch(() => {})
    }
  }
}

/**
 * Pure builder for the ffmpeg argv. Exported for tests so we can assert the
 * flags without running ffmpeg.
 */
export function buildFFmpegScrubArgs(
  action: ScrubAction,
  inputName: string,
  outputName: string
): string[] {
  const args: string[] = ['-i', inputName]
  if (action.mode === 'strip') {
    args.push('-map_metadata', '-1', '-c', 'copy')
  } else {
    args.push('-map_metadata', '0', '-c', 'copy')
    for (const field of action.fields) {
      const key = field.key.trim()
      if (!key) continue
      args.push('-metadata', `${key}=${field.value}`)
    }
  }
  args.push(outputName)
  return args
}

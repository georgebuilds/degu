import { FFMPEG_CORE_MT_VERSION, MAX_TRIM_INPUT_BYTES } from './video-trim-scope.ts'
import type { FFmpeg, ProgressEventCallback } from '@ffmpeg/ffmpeg'
import ffmpegClassWorkerEntryUrl from '@ffmpeg/ffmpeg/worker?url&inline'

const CDN_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@${FFMPEG_CORE_MT_VERSION}/dist/esm`

let ffmpegInstance: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null

export function terminateFFmpeg(): void {
  ffmpegInstance?.terminate()
  ffmpegInstance = null
  loadPromise = null
}

/**
 * Lazy-load the shared ffmpeg-core instance.
 *
 * Exported so other callers (scrub-metadata) reuse the same worker/wasm
 * download rather than loading a second copy.
 */
export async function getLoadedFFmpeg(signal?: AbortSignal): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
          import('@ffmpeg/ffmpeg'),
          import('@ffmpeg/util'),
        ])
        const ffmpeg = new FFmpeg()
        const classWorkerURL = await toBlobURL(
          ffmpegClassWorkerEntryUrl,
          'text/javascript'
        )
        await ffmpeg.load(
          {
            classWorkerURL,
            coreURL: await toBlobURL(
              `${CDN_BASE}/ffmpeg-core.js`,
              'text/javascript'
            ),
            wasmURL: await toBlobURL(
              `${CDN_BASE}/ffmpeg-core.wasm`,
              'application/wasm'
            ),
            workerURL: await toBlobURL(
              `${CDN_BASE}/ffmpeg-core.worker.js`,
              'text/javascript'
            ),
          },
          { signal }
        )
        ffmpegInstance = ffmpeg
        return ffmpeg
      } catch (e) {
        loadPromise = null
        ffmpegInstance = null
        throw e
      }
    })()
  }
  return loadPromise
}

export type TrimProgress = (ratio: number) => void

/**
 * Trim using stream copy (`-c copy`). Fast; cut points snap to keyframes.
 * Caller must ensure `file.size <= MAX_TRIM_INPUT_BYTES`.
 */
export async function trimVideoStreamCopy(options: {
  file: File
  startSec: number
  endSec: number
  onProgress?: TrimProgress
  signal?: AbortSignal
}): Promise<Uint8Array> {
  const { file, startSec, endSec, onProgress, signal } = options
  if (file.size > MAX_TRIM_INPUT_BYTES) {
    throw new Error(
      `File is too large to trim in the browser (max ${MAX_TRIM_INPUT_BYTES / (1024 * 1024)} MB).`
    )
  }
  let a = startSec
  let b = endSec
  if (a > b) [a, b] = [b, a]
  const duration = b - a
  if (!Number.isFinite(duration) || duration <= 0.04) {
    throw new Error('Invalid trim range.')
  }

  const dot = file.name.lastIndexOf('.')
  const ext = dot >= 0 ? file.name.slice(dot) : '.mp4'
  const tag = Math.random().toString(36).slice(2, 10)
  const inputName = `trim_in_${tag}${ext}`
  const outputName = `trim_out_${tag}${ext}`

  const ffmpeg = await getLoadedFFmpeg(signal)

  const onFfmpegProgress: ProgressEventCallback = ({ progress }) => {
    if (typeof progress === 'number' && onProgress) onProgress(progress)
  }
  if (onProgress) ffmpeg.on('progress', onFfmpegProgress)

  const { fetchFile } = await import('@ffmpeg/util')
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file), { signal })
    const code = await ffmpeg.exec(
      [
        '-ss',
        String(a),
        '-i',
        inputName,
        '-t',
        String(duration),
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        outputName,
      ],
      undefined,
      { signal }
    )
    if (code !== 0) {
      throw new Error(`ffmpeg failed (exit ${String(code)})`)
    }
    const data = await ffmpeg.readFile(outputName, undefined, { signal })
    if (data instanceof Uint8Array) return data
    throw new Error('Unexpected ffmpeg output')
  } finally {
    if (onProgress) ffmpeg.off('progress', onFfmpegProgress)
    // terminateFFmpeg() flips `loaded` to false and kills the worker, so the
    // virtual FS is gone; skip deletes in that case.
    if (ffmpeg.loaded) {
      await ffmpeg.deleteFile(inputName).catch(() => {})
      await ffmpeg.deleteFile(outputName).catch(() => {})
    }
  }
}

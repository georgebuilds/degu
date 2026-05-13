import type { AppMode } from '../components/ModeRail.tsx'

const KEY_DEFAULT_MODE = 'degu_default_mode'
const KEY_INTRO_DISMISSED = 'degu_intro_dismissed_v1'

function isAppMode(v: unknown): v is AppMode {
  return v === 'triage' || v === 'library' || v === 'tags' || v === 'people'
}

export function loadDefaultStartMode(): AppMode {
  try {
    const raw = localStorage.getItem(KEY_DEFAULT_MODE)
    return isAppMode(raw) ? raw : 'triage'
  } catch {
    return 'triage'
  }
}

export function saveDefaultStartMode(mode: AppMode): void {
  try {
    localStorage.setItem(KEY_DEFAULT_MODE, mode)
    for (const fn of defaultModeListeners) fn()
  } catch {
    /* ignore quota / private mode */
  }
}

const defaultModeListeners = new Set<() => void>()

export function subscribeDefaultStartMode(fn: () => void): () => void {
  defaultModeListeners.add(fn)
  return () => { defaultModeListeners.delete(fn) }
}

/**
 * If storage is unavailable we treat the ribbon as already dismissed —
 * better to under-show than re-nag on every refresh.
 */
export function isIntroDismissed(): boolean {
  try {
    return localStorage.getItem(KEY_INTRO_DISMISSED) === '1'
  } catch {
    return true
  }
}

export function dismissIntro(): void {
  try {
    localStorage.setItem(KEY_INTRO_DISMISSED, '1')
    for (const fn of introListeners) fn()
  } catch {
    /* ignore */
  }
}

const introListeners = new Set<() => void>()

export function subscribeIntroDismissed(fn: () => void): () => void {
  introListeners.add(fn)
  return () => { introListeners.delete(fn) }
}

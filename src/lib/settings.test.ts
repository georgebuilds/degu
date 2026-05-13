/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dismissIntro,
  isIntroDismissed,
  loadDefaultStartMode,
  saveDefaultStartMode,
  subscribeDefaultStartMode,
  subscribeIntroDismissed,
} from './settings'

afterEach(() => {
  localStorage.clear()
})

describe('default start mode', () => {
  it('returns triage when nothing is stored', () => {
    expect(loadDefaultStartMode()).toBe('triage')
  })

  it('round-trips library', () => {
    saveDefaultStartMode('library')
    expect(loadDefaultStartMode()).toBe('library')
  })

  it('round-trips tags', () => {
    saveDefaultStartMode('tags')
    expect(loadDefaultStartMode()).toBe('tags')
  })

  it('falls back to triage on a garbage stored value', () => {
    localStorage.setItem('degu_default_mode', 'wat')
    expect(loadDefaultStartMode()).toBe('triage')
  })

  it('notifies subscribers on save', () => {
    const fn = vi.fn()
    const unsubscribe = subscribeDefaultStartMode(fn)
    saveDefaultStartMode('library')
    saveDefaultStartMode('tags')
    expect(fn).toHaveBeenCalledTimes(2)
    unsubscribe()
    saveDefaultStartMode('triage')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('intro dismissal', () => {
  it('starts undismissed', () => {
    expect(isIntroDismissed()).toBe(false)
  })

  it('persists dismissal', () => {
    dismissIntro()
    expect(isIntroDismissed()).toBe(true)
  })

  it('notifies subscribers on dismiss', () => {
    const fn = vi.fn()
    const unsubscribe = subscribeIntroDismissed(fn)
    dismissIntro()
    expect(fn).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})

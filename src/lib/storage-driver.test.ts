import { afterEach, describe, expect, it } from 'vitest'
import {
  clearActiveDriver,
  getActiveDriver,
  getActiveDriverOrNull,
  setActiveDriver,
  type StorageDriver,
  type TagPayload,
} from './storage-driver.ts'

function makeDriver(kind: 'http' | 'fsa' = 'http'): StorageDriver {
  const empty: TagPayload = {
    tags: {},
    videoLoops: {},
    tagCreatedAt: {},
    lastReviewed: {},
  }
  return {
    kind,
    rootHandle: { name: 'root' } as unknown as FileSystemDirectoryHandle,
    rootName: 'root',
    loadTags: async () => empty,
    saveTags: async () => {},
  }
}

afterEach(() => {
  clearActiveDriver()
})

describe('active driver singleton', () => {
  it('getActiveDriverOrNull returns null before any driver is set', () => {
    expect(getActiveDriverOrNull()).toBeNull()
  })

  it('getActiveDriver throws before any driver is set', () => {
    expect(() => getActiveDriver()).toThrow('storage driver: no active driver')
  })

  it('setActiveDriver makes the driver retrievable via both getters', () => {
    const driver = makeDriver('fsa')
    setActiveDriver(driver)
    expect(getActiveDriver()).toBe(driver)
    expect(getActiveDriverOrNull()).toBe(driver)
    expect(getActiveDriver().kind).toBe('fsa')
  })

  it('setActiveDriver replaces a previously active driver', () => {
    const first = makeDriver('http')
    const second = makeDriver('fsa')
    setActiveDriver(first)
    setActiveDriver(second)
    expect(getActiveDriver()).toBe(second)
  })

  it('clearActiveDriver resets to the no-driver state', () => {
    setActiveDriver(makeDriver())
    clearActiveDriver()
    expect(getActiveDriverOrNull()).toBeNull()
    expect(() => getActiveDriver()).toThrow()
  })

  it('a set driver exposes its load/save surface', async () => {
    const driver = makeDriver()
    setActiveDriver(driver)
    const payload = await getActiveDriver().loadTags()
    expect(payload).toEqual({
      tags: {},
      videoLoops: {},
      tagCreatedAt: {},
      lastReviewed: {},
    })
    await expect(getActiveDriver().saveTags(payload)).resolves.toBeUndefined()
  })
})

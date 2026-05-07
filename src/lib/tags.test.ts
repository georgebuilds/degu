import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  SaveTagsOptions,
  StorageDriver,
  TagPayload,
} from './storage-driver'

type FakeDriver = StorageDriver & {
  loadTags: ReturnType<typeof vi.fn<() => Promise<TagPayload>>>
  saveTags: ReturnType<
    typeof vi.fn<(p: TagPayload, o?: SaveTagsOptions) => Promise<void>>
  >
}

function makeFakeDriver(initial?: Partial<TagPayload>): FakeDriver {
  const payload: TagPayload = {
    tags: initial?.tags ?? {},
    videoLoops: initial?.videoLoops ?? {},
    tagCreatedAt: initial?.tagCreatedAt ?? {},
    lastReviewed: initial?.lastReviewed ?? {},
  }
  const loadTags = vi.fn(async () => ({
    tags: { ...payload.tags },
    videoLoops: { ...payload.videoLoops },
    tagCreatedAt: { ...payload.tagCreatedAt },
    lastReviewed: { ...payload.lastReviewed },
  }))
  const saveTags = vi.fn(
    async (_p: TagPayload, _o?: SaveTagsOptions) => undefined
  )
  return {
    kind: 'http',
    rootHandle: {} as FileSystemDirectoryHandle,
    rootName: 'root',
    loadTags,
    saveTags,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function loadModule() {
  const tags = await import('./tags')
  const driverMod = await import('./storage-driver')
  return { tags, driverMod }
}

describe('tags.ts durability', () => {
  it('setTags is a no-op when loadState is not "loaded"', async () => {
    const { tags, driverMod } = await loadModule()
    const fake = makeFakeDriver({ tags: { 'a/b.png': ['real'] } })
    driverMod.setActiveDriver(fake)

    expect(tags.getLoadState()).toBe('idle')
    tags.setTags('a/b.png', ['scratch'])
    await vi.advanceTimersByTimeAsync(1000)

    expect(fake.saveTags).not.toHaveBeenCalled()
    expect(tags.getTags('a/b.png')).toEqual([])
  })

  it('still refuses writes when load failed (regression guard for S1)', async () => {
    const { tags, driverMod } = await loadModule()
    const fake = makeFakeDriver()
    fake.loadTags.mockRejectedValueOnce(new Error('network down'))
    driverMod.setActiveDriver(fake)

    await expect(tags.initTagIndex()).rejects.toThrow('network down')
    expect(tags.getLoadState()).toBe('failed')

    tags.setTags('a/b.png', ['x'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.saveTags).not.toHaveBeenCalled()
  })

  it('coalesces rapid setTags calls into a single save chain (S2)', async () => {
    const { tags, driverMod } = await loadModule()
    const fake = makeFakeDriver()
    const gates: Array<() => void> = []
    fake.saveTags.mockImplementation(
      () =>
        new Promise<void>(res => {
          if (gates.length === 0) {
            gates.push(res)
          } else {
            res()
          }
        })
    )
    driverMod.setActiveDriver(fake)

    await tags.initTagIndex()
    expect(tags.getLoadState()).toBe('loaded')

    tags.setTags('a.png', ['one'])
    await vi.advanceTimersByTimeAsync(500)
    // first save now in flight (pending the resolveFirst latch)
    expect(fake.saveTags).toHaveBeenCalledTimes(1)

    // While the first save is still in-flight, queue more edits.
    tags.setTags('b.png', ['two'])
    tags.setTags('c.png', ['three'])
    await vi.advanceTimersByTimeAsync(500)
    expect(fake.saveTags).toHaveBeenCalledTimes(1)

    // Resolve the first save; the queued edits should produce exactly one
    // follow-up save (not two), because they coalesce via pendingSave.
    gates[0]?.()
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect(fake.saveTags).toHaveBeenCalledTimes(2)
  })

  it('setTags(key, []) deletes index[key] but preserves lastReviewed[key] (S6)', async () => {
    const { tags, driverMod } = await loadModule()
    const fake = makeFakeDriver({
      tags: { 'p/x.png': ['old'] },
      lastReviewed: { 'p/x.png': '2020-01-01T00:00:00.000Z' },
      tagCreatedAt: { old: '2019-01-01T00:00:00.000Z' },
    })
    driverMod.setActiveDriver(fake)

    await tags.initTagIndex()
    expect(tags.getTags('p/x.png')).toEqual(['old'])
    expect(tags.getLastReviewed('p/x.png')).toBe('2020-01-01T00:00:00.000Z')

    tags.setTags('p/x.png', [])
    expect(tags.getTags('p/x.png')).toEqual([])
    // Review state ("I looked at this file") is independent of "currently tagged".
    expect(tags.getLastReviewed('p/x.png')).toBe('2020-01-01T00:00:00.000Z')

    await vi.advanceTimersByTimeAsync(500)
    expect(fake.saveTags).toHaveBeenCalledTimes(1)
    const saved = fake.saveTags.mock.calls[0][0]
    expect(saved.tags['p/x.png']).toBeUndefined()
    expect(saved.lastReviewed['p/x.png']).toBe('2020-01-01T00:00:00.000Z')
  })

  it('successful initTagIndex bumps tagIndexVersion', async () => {
    const { tags, driverMod } = await loadModule()
    const fake = makeFakeDriver({ tags: { 'a.png': ['t'] } })
    driverMod.setActiveDriver(fake)

    const before = tags.getTagIndexVersion()
    let bumped = 0
    const unsub = tags.subscribeTagIndexVersion(() => {
      bumped++
    })

    await tags.initTagIndex()
    expect(tags.getTagIndexVersion()).toBeGreaterThan(before)
    expect(bumped).toBeGreaterThan(0)
    unsub()
  })
})

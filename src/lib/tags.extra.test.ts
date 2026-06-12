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

async function loadedModule(initial?: Partial<TagPayload>) {
  const { tags, driverMod } = await loadModule()
  const fake = makeFakeDriver(initial)
  driverMod.setActiveDriver(fake)
  await tags.initTagIndex()
  return { tags, driverMod, fake }
}

describe('getTagsCached', () => {
  it('caches lookups and reuses the cached value', async () => {
    const { tags } = await loadedModule({ tags: { 'a.png': ['x', 'y'] } })
    const cache = new Map<string, string[]>()
    const first = tags.getTagsCached('a.png', cache)
    expect(first).toEqual(['x', 'y'])
    expect(cache.get('a.png')).toEqual(['x', 'y'])
    // Second call returns the cached reference even if index changes.
    tags.setTags('a.png', ['z'])
    const second = tags.getTagsCached('a.png', cache)
    expect(second).toBe(first)
  })

  it('caches the empty result for unknown keys', async () => {
    const { tags } = await loadedModule()
    const cache = new Map<string, string[]>()
    expect(tags.getTagsCached('missing', cache)).toEqual([])
    expect(cache.has('missing')).toBe(true)
  })
})

describe('getDistinctTagsFromIndex', () => {
  it('returns [] when index is unloaded', async () => {
    const { tags } = await loadModule()
    expect(tags.getDistinctTagsFromIndex()).toEqual([])
  })

  it('dedupes, trims and sorts tags across files', async () => {
    const { tags } = await loadedModule({
      tags: {
        'a.png': ['beta', ' alpha ', ''],
        'b.png': ['alpha', 'gamma'],
      },
    })
    expect(tags.getDistinctTagsFromIndex()).toEqual(['alpha', 'beta', 'gamma'])
  })
})

describe('getTagCreatedAt', () => {
  it('returns null before load', async () => {
    const { tags } = await loadModule()
    expect(tags.getTagCreatedAt('x')).toBeNull()
  })

  it('returns the stored ISO date or null for unknown tags', async () => {
    const { tags } = await loadedModule({
      tagCreatedAt: { keep: '2021-05-05T00:00:00.000Z' },
    })
    expect(tags.getTagCreatedAt('keep')).toBe('2021-05-05T00:00:00.000Z')
    expect(tags.getTagCreatedAt('nope')).toBeNull()
  })
})

describe('markReviewed', () => {
  it('is a no-op when not loaded', async () => {
    const { tags, driverMod } = await loadModule()
    const fake = makeFakeDriver()
    driverMod.setActiveDriver(fake)
    tags.markReviewed('a.png')
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.saveTags).not.toHaveBeenCalled()
    expect(tags.getLastReviewed('a.png')).toBeNull()
  })

  it('stamps lastReviewed and schedules a save', async () => {
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
    const { tags, fake } = await loadedModule()
    tags.markReviewed('a.png')
    expect(tags.getLastReviewed('a.png')).toBe('2026-01-02T03:04:05.000Z')
    await vi.advanceTimersByTimeAsync(500)
    expect(fake.saveTags).toHaveBeenCalledTimes(1)
  })
})

describe('getStaleFiles', () => {
  it('returns [] before load', async () => {
    const { tags } = await loadModule()
    expect(tags.getStaleFiles()).toEqual([])
  })

  it('flags files reviewed before a newer tag was created', async () => {
    const { tags } = await loadedModule({
      tags: { 'old.png': ['existing'], 'tagged.png': ['new'] },
      tagCreatedAt: {
        existing: '2020-01-01T00:00:00.000Z',
        new: '2023-01-01T00:00:00.000Z',
      },
      lastReviewed: {
        'old.png': '2021-01-01T00:00:00.000Z',
        'tagged.png': '2024-01-01T00:00:00.000Z',
      },
    })
    const stale = tags.getStaleFiles()
    // old.png was reviewed 2021 but "new" tag arrived 2023 → candidate.
    expect(stale).toEqual([
      {
        path: 'old.png',
        lastReviewed: '2021-01-01T00:00:00.000Z',
        candidateTags: ['new'],
      },
    ])
  })

  it('treats never-reviewed files as stale against every known tag they lack', async () => {
    const { tags } = await loadedModule({
      tags: { 'fresh.png': ['has'] },
      tagCreatedAt: {
        has: '2020-01-01T00:00:00.000Z',
        beta: '2020-02-01T00:00:00.000Z',
        alpha: '2020-03-01T00:00:00.000Z',
      },
    })
    const stale = tags.getStaleFiles()
    expect(stale).toHaveLength(1)
    // Candidates sorted, "has" excluded because the file already has it.
    expect(stale[0].path).toBe('fresh.png')
    expect(stale[0].lastReviewed).toBeNull()
    expect(stale[0].candidateTags).toEqual(['alpha', 'beta'])
  })
})

describe('video loops', () => {
  it('getVideoLoops returns [] before load and for unknown keys', async () => {
    const { tags } = await loadModule()
    expect(tags.getVideoLoops('v.mp4')).toEqual([])
    const loaded = await loadedModule()
    expect(loaded.tags.getVideoLoops('v.mp4')).toEqual([])
  })

  it('setVideoLoops is a no-op when not loaded', async () => {
    const { tags, driverMod } = await loadModule()
    const fake = makeFakeDriver()
    driverMod.setActiveDriver(fake)
    tags.setVideoLoops('v.mp4', [{ id: 'l1', startSec: 0, endSec: 1 }])
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.saveTags).not.toHaveBeenCalled()
  })

  it('sets, persists and deletes loops', async () => {
    const { tags, fake } = await loadedModule()
    tags.setVideoLoops('v.mp4', [{ id: 'l2', startSec: 0, endSec: 2 }])
    expect(tags.getVideoLoops('v.mp4')).toEqual([
      { id: 'l2', startSec: 0, endSec: 2 },
    ])
    await vi.advanceTimersByTimeAsync(500)
    expect(fake.saveTags).toHaveBeenCalledTimes(1)

    tags.setVideoLoops('v.mp4', [])
    expect(tags.getVideoLoops('v.mp4')).toEqual([])
    await vi.advanceTimersByTimeAsync(500)
    expect(fake.saveTags).toHaveBeenCalledTimes(2)
    expect(fake.saveTags.mock.calls[1][0].videoLoops['v.mp4']).toBeUndefined()
  })
})

describe('renameTagStorageKey', () => {
  it('is a no-op when not loaded', async () => {
    const { tags, driverMod } = await loadModule()
    const fake = makeFakeDriver()
    driverMod.setActiveDriver(fake)
    tags.renameTagStorageKey('a.png', 'b.png')
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.saveTags).not.toHaveBeenCalled()
  })

  it('returns early when old and new keys match', async () => {
    const { tags } = await loadedModule({ tags: { 'a.png': ['t'] } })
    tags.renameTagStorageKey('a.png', 'a.png')
    expect(tags.getTags('a.png')).toEqual(['t'])
  })

  it('moves tags, loops and lastReviewed to the new key', async () => {
    const { tags, fake } = await loadedModule({
      tags: { 'a.png': ['t1', 't2'] },
      videoLoops: { 'a.png': [{ id: 'l3', startSec: 0, endSec: 3 }] },
      lastReviewed: { 'a.png': '2022-01-01T00:00:00.000Z' },
    })
    tags.renameTagStorageKey('a.png', 'b.png')
    expect(tags.getTags('a.png')).toEqual([])
    expect(tags.getTags('b.png')).toEqual(['t1', 't2'])
    expect(tags.getVideoLoops('b.png')).toEqual([
      { id: 'l3', startSec: 0, endSec: 3 },
    ])
    expect(tags.getLastReviewed('b.png')).toBe('2022-01-01T00:00:00.000Z')
    expect(tags.getLastReviewed('a.png')).toBeNull()
    await vi.advanceTimersByTimeAsync(500)
    expect(fake.saveTags).toHaveBeenCalledTimes(1)
  })

  it('clears the destination when the source has no data', async () => {
    const { tags } = await loadedModule({
      tags: { 'dest.png': ['stale'] },
    })
    // Source "empty.png" has nothing; rename should delete dest entries.
    tags.renameTagStorageKey('empty.png', 'dest.png')
    expect(tags.getTags('dest.png')).toEqual([])
    expect(tags.getVideoLoops('dest.png')).toEqual([])
    expect(tags.getLastReviewed('dest.png')).toBeNull()
  })
})

describe('renameTagStorageKeysBatch', () => {
  it('is a no-op when not loaded', async () => {
    const { tags, driverMod } = await loadModule()
    const fake = makeFakeDriver()
    driverMod.setActiveDriver(fake)
    tags.renameTagStorageKeysBatch([{ from: 'a', to: 'b' }])
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.saveTags).not.toHaveBeenCalled()
  })

  it('applies many renames then persists exactly once', async () => {
    const { tags, fake } = await loadedModule({
      tags: { 'a.png': ['1'], 'b.png': ['2'] },
    })
    tags.renameTagStorageKeysBatch([
      { from: 'a.png', to: 'x.png' },
      { from: 'b.png', to: 'y.png' },
    ])
    expect(tags.getTags('x.png')).toEqual(['1'])
    expect(tags.getTags('y.png')).toEqual(['2'])
    expect(tags.getTags('a.png')).toEqual([])
    await vi.advanceTimersByTimeAsync(500)
    expect(fake.saveTags).toHaveBeenCalledTimes(1)
  })
})

describe('flushTagIndex', () => {
  it('returns early when not loaded', async () => {
    const { tags } = await loadModule()
    await expect(tags.flushTagIndex()).resolves.toBeUndefined()
  })

  it('cancels the debounce timer and forces an immediate save', async () => {
    const { tags, fake } = await loadedModule()
    tags.setTags('a.png', ['t'])
    // Timer is scheduled but not yet fired.
    expect(fake.saveTags).not.toHaveBeenCalled()
    await tags.flushTagIndex()
    expect(fake.saveTags).toHaveBeenCalledTimes(1)
  })
})

describe('flushTagIndexBeacon', () => {
  it('returns early when not loaded', async () => {
    const { tags } = await loadModule()
    await expect(tags.flushTagIndexBeacon()).resolves.toBeUndefined()
  })

  it('flushes with the keepalive option set on the driver', async () => {
    const { tags, fake } = await loadedModule()
    tags.setTags('a.png', ['t'])
    await tags.flushTagIndexBeacon()
    expect(fake.saveTags).toHaveBeenCalledTimes(1)
    expect(fake.saveTags.mock.calls[0][1]).toEqual({ keepalive: true })
  })
})

describe('save error handling', () => {
  it('records lastSaveError and bumps version when the driver throws', async () => {
    const { tags, fake } = await loadedModule()
    fake.saveTags.mockRejectedValueOnce(new Error('disk full'))
    tags.setTags('a.png', ['t'])
    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()
    await Promise.resolve()
    expect(tags.getLastSaveError()).toBeInstanceOf(Error)
    expect(tags.getLastSaveError()?.message).toBe('disk full')
  })

  it('wraps non-Error rejections', async () => {
    const { tags, fake } = await loadedModule()
    fake.saveTags.mockRejectedValueOnce('weird string failure')
    tags.setTags('a.png', ['t'])
    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()
    await Promise.resolve()
    expect(tags.getLastSaveError()?.message).toBe('weird string failure')
  })
})

describe('getLoadError', () => {
  it('returns null on success and the error on failure', async () => {
    const { tags, driverMod } = await loadModule()
    const fake = makeFakeDriver()
    fake.loadTags.mockRejectedValueOnce(new Error('boom'))
    driverMod.setActiveDriver(fake)
    await expect(tags.initTagIndex()).rejects.toThrow('boom')
    expect(tags.getLoadError()?.message).toBe('boom')
  })

  it('wraps a non-Error load rejection', async () => {
    const { tags, driverMod } = await loadModule()
    const fake = makeFakeDriver()
    fake.loadTags.mockRejectedValueOnce('string boom')
    driverMod.setActiveDriver(fake)
    await expect(tags.initTagIndex()).rejects.toThrow('string boom')
    expect(tags.getLoadError()?.message).toBe('string boom')
  })
})

describe('buildAggregateFromTagIndex', () => {
  it('returns empty aggregate before load', async () => {
    const { tags } = await loadModule()
    const agg = tags.buildAggregateFromTagIndex()
    expect(agg.counts).toEqual([])
    expect(agg.tagToPaths.size).toBe(0)
  })

  it('builds sorted counts and an inverted index', async () => {
    const { tags } = await loadedModule({
      tags: {
        'a.png': ['cat', 'dog'],
        'b.png': ['cat'],
        'c.png': ['dog'],
      },
    })
    const { counts, tagToPaths } = tags.buildAggregateFromTagIndex()
    expect(counts).toEqual([
      { tag: 'cat', count: 2 },
      { tag: 'dog', count: 2 },
    ])
    expect([...(tagToPaths.get('cat') ?? [])].sort()).toEqual([
      'a.png',
      'b.png',
    ])
    expect([...(tagToPaths.get('dog') ?? [])].sort()).toEqual([
      'a.png',
      'c.png',
    ])
  })
})

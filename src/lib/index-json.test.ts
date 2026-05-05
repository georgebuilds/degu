import { describe, expect, it } from 'vitest'
import {
  INDEX_META_KEY,
  buildIndexJsonObject,
  parseIndexPayload,
} from './index-json'

describe('parseIndexPayload', () => {
  it('loads legacy flat tag map only', () => {
    const raw = {
      'photos/a.jpg': ['vacation', '2024'],
      'notes.txt': ['work'],
    }
    const { tags, videoLoops } = parseIndexPayload(raw)
    expect(tags).toEqual(raw)
    expect(videoLoops).toEqual({})
  })

  it('ignores __degu for tags and loads videoLoops', () => {
    const raw = {
      'vids/b.mp4': ['clip'],
      [INDEX_META_KEY]: {
        videoLoops: {
          'vids/b.mp4': [
            { id: 'a', startSec: 1, endSec: 5 },
            { id: 'b', startSec: 10, endSec: 20 },
          ],
        },
      },
    }
    const { tags, videoLoops } = parseIndexPayload(raw)
    expect(tags).toEqual({ 'vids/b.mp4': ['clip'] })
    expect(videoLoops).toEqual({
      'vids/b.mp4': [
        { id: 'a', startSec: 1, endSec: 5 },
        { id: 'b', startSec: 10, endSec: 20 },
      ],
    })
  })

  it('skips non-array tag values and empty tag arrays', () => {
    const raw = {
      ok: ['x'],
      badObj: { x: 1 },
      badStr: 'nope',
      empty: [],
    }
    const { tags } = parseIndexPayload(raw)
    expect(tags).toEqual({ ok: ['x'] })
  })

  it('skips invalid loop entries', () => {
    const raw = {
      [INDEX_META_KEY]: {
        videoLoops: {
          'a.mp4': [
            { id: 'good', startSec: 0, endSec: 1 },
            { id: '', startSec: 0, endSec: 1 },
            { id: 'bad', startSec: 5, endSec: 2 },
            { id: 'x', startSec: NaN, endSec: 1 },
          ],
        },
      },
    }
    const { videoLoops } = parseIndexPayload(raw)
    expect(videoLoops['a.mp4']).toEqual([{ id: 'good', startSec: 0, endSec: 1 }])
  })

  it('returns empty maps for non-object root', () => {
    const empty = { tags: {}, videoLoops: {}, tagCreatedAt: {}, lastReviewed: {} }
    expect(parseIndexPayload(null)).toEqual(empty)
    expect(parseIndexPayload([])).toEqual(empty)
    expect(parseIndexPayload('x')).toEqual(empty)
  })
})

describe('buildIndexJsonObject', () => {
  it('omits __degu when there are no loops or timestamps', () => {
    const o = buildIndexJsonObject({ a: ['t'] }, {})
    expect(o).toEqual({ a: ['t'] })
    expect(o[INDEX_META_KEY]).toBeUndefined()
  })

  it('adds __degu.videoLoops when non-empty', () => {
    const loops = {
      'x.mp4': [{ id: '1', startSec: 0, endSec: 2 }],
    }
    const o = buildIndexJsonObject({ a: ['t'] }, loops)
    expect(o.a).toEqual(['t'])
    expect(o[INDEX_META_KEY]).toEqual({ videoLoops: loops })
  })

  it('adds __degu.tagCreatedAt and lastReviewed when non-empty', () => {
    const o = buildIndexJsonObject(
      { a: ['t'] },
      {},
      { t: '2024-04-12T18:42:00.000Z' },
      { a: '2024-05-01T10:00:00.000Z' }
    )
    expect(o[INDEX_META_KEY]).toEqual({
      tagCreatedAt: { t: '2024-04-12T18:42:00.000Z' },
      lastReviewed: { a: '2024-05-01T10:00:00.000Z' },
    })
  })

  it('round-trips with parseIndexPayload', () => {
    const tags = { 'p/w.mp4': ['m'] }
    const videoLoops = {
      'p/w.mp4': [{ id: 'u', startSec: 1.5, endSec: 3.25 }],
    }
    const tagCreatedAt = { m: '2024-04-12T18:42:00.000Z' }
    const lastReviewed = { 'p/w.mp4': '2024-05-01T10:00:00.000Z' }
    const written = buildIndexJsonObject(
      tags,
      videoLoops,
      tagCreatedAt,
      lastReviewed
    )
    const parsed = parseIndexPayload(written)
    expect(parsed.tags).toEqual(tags)
    expect(parsed.videoLoops).toEqual(videoLoops)
    expect(parsed.tagCreatedAt).toEqual(tagCreatedAt)
    expect(parsed.lastReviewed).toEqual(lastReviewed)
  })
})

describe('parseIndexPayload — timestamps', () => {
  it('reads tagCreatedAt and lastReviewed from __degu', () => {
    const raw = {
      'a.jpg': ['cat'],
      [INDEX_META_KEY]: {
        tagCreatedAt: { cat: '2024-01-01T00:00:00.000Z' },
        lastReviewed: { 'a.jpg': '2024-02-01T00:00:00.000Z' },
      },
    }
    const { tagCreatedAt, lastReviewed } = parseIndexPayload(raw)
    expect(tagCreatedAt).toEqual({ cat: '2024-01-01T00:00:00.000Z' })
    expect(lastReviewed).toEqual({ 'a.jpg': '2024-02-01T00:00:00.000Z' })
  })

  it('skips invalid timestamp values', () => {
    const raw = {
      [INDEX_META_KEY]: {
        tagCreatedAt: {
          good: '2024-01-01T00:00:00.000Z',
          empty: '',
          notString: 42,
          notDate: 'banana',
        },
      },
    }
    const { tagCreatedAt } = parseIndexPayload(raw)
    expect(tagCreatedAt).toEqual({ good: '2024-01-01T00:00:00.000Z' })
  })

  it('returns empty timestamp maps when __degu is absent', () => {
    const { tagCreatedAt, lastReviewed } = parseIndexPayload({ 'a.jpg': ['t'] })
    expect(tagCreatedAt).toEqual({})
    expect(lastReviewed).toEqual({})
  })
})

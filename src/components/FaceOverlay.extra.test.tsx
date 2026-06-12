/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'preact'
import type { FaceRegion, Person } from '../lib/people'

const state = vi.hoisted(() => ({
  regions: [] as FaceRegion[],
  people: [] as Person[],
  version: 0,
  listeners: new Set<() => void>(),
  nextId: 100,
  listRegionsThrows: false,
}))

const mocks = vi.hoisted(() => ({
  listFaceRegions: vi.fn(),
  listPeople: vi.fn(),
  createFaceRegion: vi.fn(),
  updateFaceRegion: vi.fn(),
  deleteFaceRegion: vi.fn(),
  createPerson: vi.fn(),
}))

vi.mock('../lib/people', () => ({
  listFaceRegions: (relPath: string) => mocks.listFaceRegions(relPath),
  listPeople: () => mocks.listPeople(),
  createFaceRegion: (input: unknown) => mocks.createFaceRegion(input),
  updateFaceRegion: (id: number, input: unknown) => mocks.updateFaceRegion(id, input),
  deleteFaceRegion: (id: number) => mocks.deleteFaceRegion(id),
  createPerson: (name: string) => mocks.createPerson(name),
  getPeopleVersion: () => state.version,
  subscribePeopleVersion: (fn: () => void) => {
    state.listeners.add(fn)
    return () => {
      state.listeners.delete(fn)
    }
  },
}))

import { FaceOverlay } from './FaceOverlay.tsx'

function bumpVersion() {
  state.version++
  for (const fn of state.listeners) fn()
}

function makeImgRef(rect: Partial<DOMRect> = {}) {
  const full: DOMRect = {
    left: 0,
    top: 0,
    right: 200,
    bottom: 200,
    width: 200,
    height: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect
  const parent = document.createElement('div')
  parent.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 200,
    bottom: 200,
    width: 200,
    height: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect
  const img = document.createElement('img')
  img.getBoundingClientRect = () => full
  parent.appendChild(img)
  document.body.appendChild(parent)
  const ref = createRef<HTMLImageElement>()
  ref.current = img
  return ref
}

function region(over: Partial<FaceRegion> = {}): FaceRegion {
  return {
    id: state.nextId++,
    relPath: 'a.jpg',
    personId: null,
    personName: null,
    x: 0.1,
    y: 0.1,
    w: 0.3,
    h: 0.3,
    source: 'manual',
    confidence: null,
    ...over,
  }
}

beforeEach(() => {
  state.regions = []
  state.people = []
  state.version = 0
  state.listeners.clear()
  state.nextId = 100
  state.listRegionsThrows = false
  mocks.listFaceRegions.mockImplementation(async () => {
    if (state.listRegionsThrows) throw new Error('boom')
    return [...state.regions]
  })
  mocks.listPeople.mockImplementation(async () => [...state.people])
  mocks.createFaceRegion.mockImplementation(async (input: { x: number; y: number; w: number; h: number }) => {
    const r = region({ ...input, source: 'manual' })
    return r
  })
  mocks.updateFaceRegion.mockImplementation(async (id: number, input: Partial<FaceRegion>) => ({
    ...region(),
    id,
    ...input,
  }))
  mocks.deleteFaceRegion.mockResolvedValue(undefined)
  mocks.createPerson.mockImplementation(async (name: string) => ({
    id: 555,
    name,
    createdAt: '2020',
  }))
  if (!('randomUUID' in crypto)) {
    // @ts-expect-error test shim
    crypto.randomUUID = () => 'uuid'
  }
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('FaceOverlay - inactive', () => {
  it('renders only the Faces toggle button when inactive', () => {
    const ref = makeImgRef()
    render(<FaceOverlay tagStorageKey="a.jpg" imgRef={ref} />)
    expect(screen.getByRole('button', { name: 'Faces' })).toBeTruthy()
    expect(mocks.listFaceRegions).not.toHaveBeenCalled()
  })

  it('returns null body path when imgRef is null but still shows toggle inactive', () => {
    const ref = createRef<HTMLImageElement>()
    ref.current = null
    const { container } = render(<FaceOverlay tagStorageKey="a.jpg" imgRef={ref} />)
    // inactive path renders a button regardless of img presence
    expect(container.querySelector('button')).toBeTruthy()
  })
})

describe('FaceOverlay - activation & loading', () => {
  it('loads regions and people when activated and renders existing regions', async () => {
    state.regions = [
      region({ id: 1, personId: 7, personName: 'Ada', source: 'auto' }),
      region({ id: 2, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }),
    ]
    const ref = makeImgRef()
    render(<FaceOverlay tagStorageKey="a.jpg" imgRef={ref} />)
    fireEvent.click(screen.getByRole('button', { name: 'Faces' }))

    await waitFor(() => {
      expect(mocks.listFaceRegions).toHaveBeenCalledWith('a.jpg')
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Faces (on)' })).toBeTruthy()
    })
    // personName label rendered for the assigned region
    await waitFor(() => {
      expect(screen.getByText('Ada')).toBeTruthy()
    })
    // two rects rendered + SVG present
    const rects = document.querySelectorAll('svg rect')
    expect(rects.length).toBe(2)
    // assigned region uses sky stroke, unassigned uses amber
    const strokes = Array.from(rects).map(r => r.getAttribute('stroke'))
    expect(strokes).toContain('#38bdf8')
    expect(strokes).toContain('#fbbf24')
  })

  it('returns null (no SVG) when img has no parentElement rect', async () => {
    // img with no parent: parentRect undefined -> render returns null after toggle
    const img = document.createElement('img')
    img.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
      x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect
    const ref = createRef<HTMLImageElement>()
    ref.current = img
    render(<FaceOverlay tagStorageKey="a.jpg" imgRef={ref} />)
    fireEvent.click(screen.getByRole('button', { name: 'Faces' }))
    await waitFor(() => expect(mocks.listFaceRegions).toHaveBeenCalled())
    // No SVG because parentRect is null
    expect(document.querySelector('svg')).toBeNull()
  })

  it('ignores listFaceRegions errors without crashing', async () => {
    state.listRegionsThrows = true
    const ref = makeImgRef()
    render(<FaceOverlay tagStorageKey="a.jpg" imgRef={ref} />)
    fireEvent.click(screen.getByRole('button', { name: 'Faces' }))
    await waitFor(() => expect(mocks.listFaceRegions).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Faces (on)' })).toBeTruthy()
  })

  it('reloads on people version bump while active', async () => {
    const ref = makeImgRef()
    render(<FaceOverlay tagStorageKey="a.jpg" imgRef={ref} />)
    fireEvent.click(screen.getByRole('button', { name: 'Faces' }))
    await waitFor(() => expect(mocks.listFaceRegions).toHaveBeenCalledTimes(1))
    await act(async () => {
      bumpVersion()
    })
    await waitFor(() => expect(mocks.listFaceRegions).toHaveBeenCalledTimes(2))
  })

  it('toggles back off and clears assigning state', async () => {
    state.regions = [region({ id: 1 })]
    const ref = makeImgRef()
    render(<FaceOverlay tagStorageKey="a.jpg" imgRef={ref} />)
    fireEvent.click(screen.getByRole('button', { name: 'Faces' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Faces (on)' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Faces (on)' }))
    expect(screen.getByRole('button', { name: 'Faces' })).toBeTruthy()
  })
})

describe('FaceOverlay - drawing draft boxes', () => {
  async function activate(ref: ReturnType<typeof makeImgRef>) {
    render(<FaceOverlay tagStorageKey="a.jpg" imgRef={ref} />)
    fireEvent.click(screen.getByRole('button', { name: 'Faces' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Faces (on)' })).toBeTruthy())
  }

  it('draws a draft box and creates a region big enough', async () => {
    const ref = makeImgRef()
    await activate(ref)
    const svg = document.querySelector('svg')!
    // mousedown at (20,20) -> normalized (0.1,0.1)
    fireEvent.mouseDown(svg, { button: 0, clientX: 20, clientY: 20 })
    // move to (120,120) -> (0.6,0.6): draft rect should appear
    act(() => {
      fireEvent(window, new MouseEvent('mousemove', { clientX: 120, clientY: 120 }))
    })
    await waitFor(() => {
      const draft = document.querySelector('svg rect[stroke-dasharray]')
      expect(draft).toBeTruthy()
    })
    await act(async () => {
      fireEvent(window, new MouseEvent('mouseup'))
    })
    await waitFor(() => {
      expect(mocks.createFaceRegion).toHaveBeenCalledTimes(1)
    })
    const arg = mocks.createFaceRegion.mock.calls[0]![0] as { x: number; w: number; source: string }
    expect(arg.source).toBe('manual')
    expect(arg.x).toBeCloseTo(0.1, 5)
    expect(arg.w).toBeCloseTo(0.5, 5)
  })

  it('ignores non-left mouse button', async () => {
    const ref = makeImgRef()
    await activate(ref)
    const svg = document.querySelector('svg')!
    fireEvent.mouseDown(svg, { button: 2, clientX: 20, clientY: 20 })
    expect(document.querySelector('svg rect[stroke-dasharray]')).toBeNull()
  })

  it('does not create a region for a too-small drag', async () => {
    const ref = makeImgRef()
    await activate(ref)
    const svg = document.querySelector('svg')!
    fireEvent.mouseDown(svg, { button: 0, clientX: 20, clientY: 20 })
    act(() => {
      // move by 1px -> w,h < 0.02
      fireEvent(window, new MouseEvent('mousemove', { clientX: 21, clientY: 21 }))
    })
    await act(async () => {
      fireEvent(window, new MouseEvent('mouseup'))
    })
    expect(mocks.createFaceRegion).not.toHaveBeenCalled()
  })
})

describe('FaceOverlay - assignment popover', () => {
  async function activate(ref: ReturnType<typeof makeImgRef>) {
    render(<FaceOverlay tagStorageKey="a.jpg" imgRef={ref} />)
    fireEvent.click(screen.getByRole('button', { name: 'Faces' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Faces (on)' })).toBeTruthy())
  }

  it('opens popover on region click, filters people, and assigns existing person', async () => {
    state.regions = [region({ id: 1 })]
    state.people = [
      { id: 10, name: 'Alice', createdAt: '' },
      { id: 11, name: 'Bob', createdAt: '' },
    ]
    const ref = makeImgRef()
    await activate(ref)
    await waitFor(() => expect(document.querySelector('svg rect')).toBeTruthy())

    fireEvent.click(document.querySelector('svg rect')!)
    await waitFor(() => expect(screen.getByPlaceholderText('Search or type name…')).toBeTruthy())
    // both people listed
    expect(screen.getByRole('button', { name: 'Alice' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bob' })).toBeTruthy()

    // filter to Alice
    const input = screen.getByPlaceholderText('Search or type name…')
    fireEvent.input(input, { target: { value: 'ali' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Bob' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Alice' }))
    await waitFor(() => expect(mocks.updateFaceRegion).toHaveBeenCalledWith(1, expect.objectContaining({ personId: 10 })))
  })

  it('Enter with single filtered person assigns that person', async () => {
    state.regions = [region({ id: 2 })]
    state.people = [{ id: 20, name: 'Solo', createdAt: '' }]
    const ref = makeImgRef()
    await activate(ref)
    await waitFor(() => expect(document.querySelector('svg rect')).toBeTruthy())
    fireEvent.click(document.querySelector('svg rect')!)
    const input = await screen.findByPlaceholderText('Search or type name…')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mocks.updateFaceRegion).toHaveBeenCalledWith(2, expect.objectContaining({ personId: 20 })))
  })

  it('Enter with no match and a query creates and assigns a new person', async () => {
    state.regions = [region({ id: 3 })]
    state.people = []
    const ref = makeImgRef()
    await activate(ref)
    await waitFor(() => expect(document.querySelector('svg rect')).toBeTruthy())
    fireEvent.click(document.querySelector('svg rect')!)
    const input = await screen.findByPlaceholderText('Search or type name…')
    fireEvent.input(input, { target: { value: 'Newbie' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mocks.createPerson).toHaveBeenCalledWith('Newbie'))
    await waitFor(() => expect(mocks.updateFaceRegion).toHaveBeenCalledWith(3, expect.objectContaining({ personId: 555 })))
  })

  it('clicking the Create option creates and assigns', async () => {
    state.regions = [region({ id: 4 })]
    const ref = makeImgRef()
    await activate(ref)
    await waitFor(() => expect(document.querySelector('svg rect')).toBeTruthy())
    fireEvent.click(document.querySelector('svg rect')!)
    const input = await screen.findByPlaceholderText('Search or type name…')
    fireEvent.input(input, { target: { value: 'Zed' } })
    const createBtn = await screen.findByRole('button', { name: /Create "Zed"/ })
    fireEvent.click(createBtn)
    await waitFor(() => expect(mocks.createPerson).toHaveBeenCalledWith('Zed'))
  })

  it('Escape closes the popover', async () => {
    state.regions = [region({ id: 5 })]
    const ref = makeImgRef()
    await activate(ref)
    await waitFor(() => expect(document.querySelector('svg rect')).toBeTruthy())
    fireEvent.click(document.querySelector('svg rect')!)
    const input = await screen.findByPlaceholderText('Search or type name…')
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByPlaceholderText('Search or type name…')).toBeNull())
  })

  it('shows Reassign/Currently for an already-named region and deletes it', async () => {
    state.regions = [region({ id: 6, personId: 9, personName: 'Existing' })]
    const ref = makeImgRef()
    await activate(ref)
    await waitFor(() => expect(document.querySelector('svg rect')).toBeTruthy())
    fireEvent.click(document.querySelector('svg rect')!)
    await waitFor(() => expect(screen.getByText('Reassign')).toBeTruthy())
    expect(screen.getByText('Currently:')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete region' }))
    await waitFor(() => expect(mocks.deleteFaceRegion).toHaveBeenCalledWith(6))
    await waitFor(() => expect(screen.queryByText('Reassign')).toBeNull())
  })

  it('clicking an open region toggles the popover closed', async () => {
    state.regions = [region({ id: 7 })]
    const ref = makeImgRef()
    await activate(ref)
    await waitFor(() => expect(document.querySelector('svg rect')).toBeTruthy())
    const rect = document.querySelector('svg rect')!
    fireEvent.click(rect)
    await waitFor(() => expect(screen.getByPlaceholderText('Search or type name…')).toBeTruthy())
    fireEvent.click(rect)
    await waitFor(() => expect(screen.queryByPlaceholderText('Search or type name…')).toBeNull())
  })
})

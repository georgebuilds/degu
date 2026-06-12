/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Person, FaceRegion } from '../lib/people'

const mockState = vi.hoisted(() => ({
  people: [] as Person[],
  faces: [] as FaceRegion[],
  listPeopleError: null as Error | null,
}))

const mockFns = vi.hoisted(() => ({
  listPeople: vi.fn(),
  createPerson: vi.fn(),
  renamePerson: vi.fn(),
  deletePerson: vi.fn(),
  listFaceRegionsByPerson: vi.fn(),
}))

vi.mock('../lib/people', () => {
  let version = 0
  const listeners = new Set<() => void>()
  const bump = () => {
    version++
    for (const fn of listeners) fn()
  }
  mockFns.listPeople.mockImplementation(async () => {
    if (mockState.listPeopleError) throw mockState.listPeopleError
    return mockState.people
  })
  mockFns.createPerson.mockImplementation(async (name: string) => {
    const p: Person = { id: Date.now(), name, createdAt: new Date().toISOString() }
    mockState.people = [...mockState.people, p]
    bump()
    return p
  })
  mockFns.renamePerson.mockImplementation(async (id: number, name: string) => {
    mockState.people = mockState.people.map(p => (p.id === id ? { ...p, name } : p))
    bump()
    return mockState.people.find(p => p.id === id)!
  })
  mockFns.deletePerson.mockImplementation(async (id: number) => {
    mockState.people = mockState.people.filter(p => p.id !== id)
    bump()
  })
  mockFns.listFaceRegionsByPerson.mockImplementation(async () => mockState.faces)
  return {
    listPeople: mockFns.listPeople,
    createPerson: mockFns.createPerson,
    renamePerson: mockFns.renamePerson,
    deletePerson: mockFns.deletePerson,
    listFaceRegionsByPerson: mockFns.listFaceRegionsByPerson,
    getPeopleVersion: () => version,
    subscribePeopleVersion: (fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
})

import { PeopleScreen } from './PeopleScreen.tsx'

function person(id: number, name: string): Person {
  return { id, name, createdAt: new Date(Date.now() - 86_400_000).toISOString() }
}

function face(id: number, relPath: string, personId: number): FaceRegion {
  return {
    id,
    relPath,
    personId,
    x: 0.5,
    y: 0.25,
    w: 0.1,
    h: 0.1,
    source: 'manual',
    confidence: null,
  }
}

beforeEach(() => {
  mockState.people = []
  mockState.faces = []
  mockState.listPeopleError = null
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PeopleScreen', () => {
  it('shows loading then empty state', async () => {
    render(<PeopleScreen rootFolderName="root" />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('No people yet. Add one above.')).toBeTruthy()
    })
    expect(screen.getByText('root')).toBeTruthy()
  })

  it('renders the people list with names and count', async () => {
    mockState.people = [person(1, 'Alice'), person(2, 'Bob')]
    render(<PeopleScreen rootFolderName="root" />)
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeTruthy()
    })
    expect(screen.getByText('Bob')).toBeTruthy()
    // header count
    expect(screen.getByText('2')).toBeTruthy()
    // avatar initial
    expect(screen.getByText('A')).toBeTruthy()
  })

  it('shows error state when listPeople rejects, dismissable', async () => {
    mockState.listPeopleError = new Error('boom')
    render(<PeopleScreen rootFolderName="root" />)
    await waitFor(() => {
      expect(screen.getByText('boom')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))
    await waitFor(() => {
      expect(screen.queryByText('boom')).toBeNull()
    })
  })

  it('creates a person via the add form', async () => {
    render(<PeopleScreen rootFolderName="root" />)
    await waitFor(() => {
      expect(screen.getByText('No people yet. Add one above.')).toBeTruthy()
    })

    const input = screen.getByPlaceholderText('New person…')
    fireEvent.input(input, { target: { value: 'Carol' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    })

    expect(mockFns.createPerson).toHaveBeenCalledWith('Carol')
    await waitFor(() => {
      expect(screen.getByText('Carol')).toBeTruthy()
    })
  })

  it('does not create a person for blank input', async () => {
    render(<PeopleScreen rootFolderName="root" />)
    await waitFor(() => {
      expect(screen.getByText('No people yet. Add one above.')).toBeTruthy()
    })
    const addBtn = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement
    expect(addBtn.disabled).toBe(true)
  })

  it('renames a person inline', async () => {
    mockState.people = [person(1, 'Alice')]
    render(<PeopleScreen rootFolderName="root" />)
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByDisplayValue('Alice')
    fireEvent.input(input, { target: { value: 'Alicia' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    expect(mockFns.renamePerson).toHaveBeenCalledWith(1, 'Alicia')
    await waitFor(() => {
      expect(screen.getByText('Alicia')).toBeTruthy()
    })
  })

  it('cancels inline rename without calling renamePerson', async () => {
    mockState.people = [person(1, 'Alice')]
    render(<PeopleScreen rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByDisplayValue('Alice')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockFns.renamePerson).not.toHaveBeenCalled()
    // Editing form is gone; the Rename action button is back.
    expect(screen.queryByDisplayValue('Alice')).toBeNull()
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy()
  })

  it('deletes a person', async () => {
    mockState.people = [person(1, 'Alice'), person(2, 'Bob')]
    render(<PeopleScreen rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy())

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    await act(async () => {
      fireEvent.click(deleteButtons[0])
    })

    expect(mockFns.deletePerson).toHaveBeenCalledWith(1)
    await waitFor(() => {
      expect(screen.queryByText('Alice')).toBeNull()
    })
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('selecting a person with no faces shows empty detail pane', async () => {
    mockState.people = [person(1, 'Alice')]
    mockState.faces = []
    render(<PeopleScreen rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByText('Alice'))
    })

    await waitFor(() => {
      expect(screen.getByText('No face regions tagged for Alice yet.')).toBeTruthy()
    })
    // detail heading
    expect(screen.getByRole('heading', { level: 2, name: 'Alice' })).toBeTruthy()
  })

  it('selecting a person with faces renders the face grid', async () => {
    mockState.people = [person(1, 'Alice')]
    mockState.faces = [
      face(10, 'photos/a.jpg', 1),
      face(11, 'photos/b.jpg', 1),
    ]
    render(<PeopleScreen rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByText('Alice'))
    })

    await waitFor(() => {
      expect(screen.getByText('a.jpg')).toBeTruthy()
    })
    expect(screen.getByText('b.jpg')).toBeTruthy()
    expect(screen.getByText('2 face regions across 2 files')).toBeTruthy()
    // position label derived from x/y (one per face)
    expect(screen.getAllByText(/at 50%, 25%/)).toHaveLength(2)
  })

  it('shows placeholder when no person is selected', async () => {
    mockState.people = [person(1, 'Alice')]
    render(<PeopleScreen rootFolderName="root" />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy())
    expect(screen.getByText('Select a person to see their tagged photos.')).toBeTruthy()
  })
})

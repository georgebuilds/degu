import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  type Person,
  type FaceRegion,
  listPeople,
  createPerson,
  renamePerson,
  deletePerson,
  listFaceRegionsByPerson,
  getPeopleVersion,
  subscribePeopleVersion,
} from '../lib/people'

type PeopleScreenProps = {
  rootFolderName: string
}

function usePeopleVersion(): number {
  const [v, setV] = useState(() => getPeopleVersion())
  useEffect(() => subscribePeopleVersion(() => setV(getPeopleVersion())), [])
  return v
}

export function PeopleScreen({ rootFolderName }: PeopleScreenProps) {
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null)
  const [personFaces, setPersonFaces] = useState<FaceRegion[]>([])
  const [facesLoading, setFacesLoading] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)
  const version = usePeopleVersion()

  const loadPeople = useCallback(async () => {
    try {
      const result = await listPeople()
      setPeople(result)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load people')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadPeople() }, [loadPeople, version])

  useEffect(() => {
    if (!selectedPerson) { setPersonFaces([]); return }
    let cancelled = false
    setFacesLoading(true)
    listFaceRegionsByPerson(selectedPerson.id).then(faces => {
      if (!cancelled) { setPersonFaces(faces); setFacesLoading(false) }
    }).catch(() => {
      if (!cancelled) { setPersonFaces([]); setFacesLoading(false) }
    })
    return () => { cancelled = true }
  }, [selectedPerson, version])

  const handleCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name) return
    try {
      await createPerson(name)
      setNewName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create person')
    }
  }, [newName])

  const handleRename = useCallback(async (id: number) => {
    const name = editName.trim()
    if (!name) return
    try {
      await renamePerson(id, name)
      setEditingId(null)
      setEditName('')
      if (selectedPerson?.id === id) {
        setSelectedPerson(prev => prev ? { ...prev, name } : null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename')
    }
  }, [editName, selectedPerson])

  const handleDelete = useCallback(async (id: number) => {
    try {
      await deletePerson(id)
      if (selectedPerson?.id === id) setSelectedPerson(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }, [selectedPerson])

  const startEditing = useCallback((p: Person) => {
    setEditingId(p.id)
    setEditName(p.name)
    requestAnimationFrame(() => editInputRef.current?.focus())
  }, [])

  const distinctPaths = useMemo(() => {
    const s = new Set(personFaces.map(f => f.relPath))
    return s.size
  }, [personFaces])

  if (loading) {
    return (
      <div class="flex min-h-0 flex-1 items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    )
  }

  return (
    <div class="flex min-h-0 flex-1">
      {/* Left: people list */}
      <div class="flex w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <header class="border-b border-zinc-800 px-5 py-4">
          <div class="font-mono text-xs text-zinc-500">{rootFolderName}</div>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
            People
            <span class="ml-2 font-mono text-sm font-normal text-zinc-500">
              {people.length}
            </span>
          </h1>
        </header>

        {/* Create new person */}
        <form
          class="flex gap-2 border-b border-zinc-800 px-4 py-3"
          onSubmit={e => { e.preventDefault(); void handleCreate() }}
        >
          <input
            type="text"
            placeholder="New person…"
            value={newName}
            onInput={e => setNewName((e.target as HTMLInputElement).value)}
            class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            class="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
          >
            Add
          </button>
        </form>

        {error ? (
          <div class="border-b border-red-900/50 bg-red-950/30 px-4 py-2 text-xs text-red-400">
            {error}
            <button
              type="button"
              class="ml-2 text-red-500 underline"
              onClick={() => setError(null)}
            >
              dismiss
            </button>
          </div>
        ) : null}

        {/* People list */}
        <ul class="flex-1 overflow-y-auto">
          {people.length === 0 ? (
            <li class="px-5 py-8 text-center text-sm text-zinc-500">
              No people yet. Add one above.
            </li>
          ) : people.map(p => (
            <li
              key={p.id}
              class={`group flex items-center gap-2 border-b border-zinc-800/60 px-4 py-2.5 transition-colors cursor-pointer ${
                selectedPerson?.id === p.id
                  ? 'bg-sky-500/10 border-l-2 border-l-sky-500'
                  : 'hover:bg-zinc-900'
              }`}
              onClick={() => setSelectedPerson(p)}
            >
              {/* Avatar circle with initial */}
              <div class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-800 text-sm font-medium text-zinc-300">
                {p.name.charAt(0).toUpperCase()}
              </div>

              {editingId === p.id ? (
                <form
                  class="flex min-w-0 flex-1 gap-1"
                  onSubmit={e => { e.preventDefault(); void handleRename(p.id) }}
                >
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editName}
                    onInput={e => setEditName((e.target as HTMLInputElement).value)}
                    onKeyDown={e => { if (e.key === 'Escape') setEditingId(null) }}
                    class="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-sm text-zinc-100 focus:border-sky-500 focus:outline-none"
                  />
                  <button type="submit" class="text-xs text-sky-400 hover:text-sky-300">Save</button>
                  <button type="button" class="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setEditingId(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm text-zinc-100">{p.name}</div>
                    <div class="text-[11px] text-zinc-500">
                      {formatRelativeDate(p.createdAt)}
                    </div>
                  </div>
                  <span class="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      class="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                      onClick={e => { e.stopPropagation(); startEditing(p) }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      class="rounded px-1.5 py-0.5 text-[11px] text-red-400 hover:bg-red-950 hover:text-red-300"
                      onClick={e => { e.stopPropagation(); void handleDelete(p.id) }}
                    >
                      Delete
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Right: detail pane */}
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-8 py-6">
        {!selectedPerson ? (
          <div class="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Select a person to see their tagged photos.
          </div>
        ) : (
          <>
            <header class="mb-6">
              <h2 class="text-xl font-semibold text-zinc-100">
                {selectedPerson.name}
              </h2>
              <p class="mt-1 text-sm text-zinc-500">
                {facesLoading ? 'Loading…' : (
                  `${personFaces.length} face region${personFaces.length === 1 ? '' : 's'} across ${distinctPaths} file${distinctPaths === 1 ? '' : 's'}`
                )}
              </p>
            </header>

            {personFaces.length === 0 && !facesLoading ? (
              <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
                <p class="text-sm text-zinc-400">
                  No face regions tagged for {selectedPerson.name} yet.
                </p>
                <p class="mt-2 text-xs text-zinc-500">
                  Open a photo in the preview modal and use the face tool to draw a region.
                </p>
              </div>
            ) : (
              <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {personFaces.map(face => (
                  <li
                    key={face.id}
                    class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
                  >
                    <div class="grid h-8 w-8 shrink-0 place-items-center rounded bg-zinc-800">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-500">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm text-zinc-200" title={face.relPath}>
                        {face.relPath.split('/').pop()}
                      </div>
                      <div class="text-[11px] text-zinc-500">
                        {face.x != null && face.y != null
                          ? `at ${(face.x * 100).toFixed(0)}%, ${(face.y * 100).toFixed(0)}%`
                          : 'no position'}
                        {' · '}
                        {face.source}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function formatRelativeDate(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const day = 86_400_000
  const days = Math.round(diff / day)
  if (days <= 0) return 'added today'
  if (days === 1) return 'added yesterday'
  if (days < 14) return `added ${days} days ago`
  const weeks = Math.round(days / 7)
  if (weeks < 8) return `added ${weeks} weeks ago`
  const months = Math.round(days / 30)
  return `added ${months} months ago`
}

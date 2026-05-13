/**
 * People & face-region API client.
 *
 * Separate from the tag system — people are their own CRUD resource with
 * individual mutations (no full-state replacement). The cache is kept in
 * memory and invalidated on writes; callers subscribe via the version bump
 * pattern used by tags.ts.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type Person = {
  id: number
  name: string
  createdAt: string
}

export type FaceRegion = {
  id: number
  relPath: string
  personId: number | null
  personName?: string | null
  x: number | null
  y: number | null
  w: number | null
  h: number | null
  source: 'manual' | 'auto' | 'confirmed'
  confidence: number | null
}

export type CreateFaceRegionInput = {
  relPath: string
  personId?: number | null
  x?: number | null
  y?: number | null
  w?: number | null
  h?: number | null
  source?: 'manual' | 'auto' | 'confirmed'
  confidence?: number | null
}

export type UpdateFaceRegionInput = {
  personId?: number | null
  x?: number | null
  y?: number | null
  w?: number | null
  h?: number | null
  source?: 'manual' | 'auto' | 'confirmed'
  confidence?: number | null
}

// ── Version / subscription (same pattern as tags.ts) ─────────────────────────

let peopleVersion = 0
type VersionListener = () => void
const versionListeners = new Set<VersionListener>()

function bumpPeopleVersion(): void {
  peopleVersion++
  for (const fn of versionListeners) fn()
}

export function getPeopleVersion(): number {
  return peopleVersion
}

export function subscribePeopleVersion(fn: VersionListener): () => void {
  versionListeners.add(fn)
  return () => { versionListeners.delete(fn) }
}

// ── In-memory cache ──────────────────────────────────────────────────────────

let peopleCache: Person[] | null = null

// ── HTTP helpers ─────────────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`${init?.method ?? 'GET'} ${path}: ${res.status} ${body}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(t)
  }
}

function jsonBody(data: unknown): RequestInit {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }
}

// ── People API ───────────────────────────────────────────────────────────────

export async function listPeople(): Promise<Person[]> {
  if (peopleCache) return peopleCache
  const result = await api<Person[]>('/api/people')
  peopleCache = result
  return result
}

export async function createPerson(name: string): Promise<Person> {
  const p = await api<Person>('/api/people', {
    method: 'POST',
    ...jsonBody({ name }),
  })
  peopleCache = null
  bumpPeopleVersion()
  return p
}

export async function renamePerson(id: number, name: string): Promise<Person> {
  const p = await api<Person>(`/api/people/${id}`, {
    method: 'PUT',
    ...jsonBody({ name }),
  })
  peopleCache = null
  bumpPeopleVersion()
  return p
}

export async function deletePerson(id: number): Promise<void> {
  await api<{ ok: boolean }>(`/api/people/${id}`, { method: 'DELETE' })
  peopleCache = null
  bumpPeopleVersion()
}

// ── Face regions API ─────────────────────────────────────────────────────────

export async function listFaceRegions(relPath: string): Promise<FaceRegion[]> {
  return api<FaceRegion[]>(`/api/faces?path=${encodeURIComponent(relPath)}`)
}

export async function listFaceRegionsByPerson(personId: number): Promise<FaceRegion[]> {
  return api<FaceRegion[]>(`/api/faces/by-person/${personId}`)
}

export async function createFaceRegion(input: CreateFaceRegionInput): Promise<FaceRegion> {
  const region = await api<FaceRegion>('/api/faces', {
    method: 'POST',
    ...jsonBody(input),
  })
  bumpPeopleVersion()
  return region
}

export async function updateFaceRegion(id: number, input: UpdateFaceRegionInput): Promise<FaceRegion> {
  const region = await api<FaceRegion>(`/api/faces/${id}`, {
    method: 'PUT',
    ...jsonBody(input),
  })
  bumpPeopleVersion()
  return region
}

export async function deleteFaceRegion(id: number): Promise<void> {
  await api<{ ok: boolean }>(`/api/faces/${id}`, { method: 'DELETE' })
  bumpPeopleVersion()
}

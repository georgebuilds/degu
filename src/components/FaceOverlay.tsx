import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  type Person,
  type FaceRegion,
  listPeople,
  listFaceRegions,
  createFaceRegion,
  updateFaceRegion,
  deleteFaceRegion,
  createPerson,
  getPeopleVersion,
  subscribePeopleVersion,
} from '../lib/people'

type FaceOverlayProps = {
  tagStorageKey: string
  imgRef: preact.RefObject<HTMLImageElement | null>
}

type DraftBox = {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

function usePeopleVersion(): number {
  const [v, setV] = useState(() => getPeopleVersion())
  useEffect(() => subscribePeopleVersion(() => setV(getPeopleVersion())), [])
  return v
}

export function FaceOverlay({ tagStorageKey, imgRef }: FaceOverlayProps) {
  const [active, setActive] = useState(false)
  const [regions, setRegions] = useState<FaceRegion[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [draft, setDraft] = useState<DraftBox | null>(null)
  const [assigningId, setAssigningId] = useState<number | null>(null)
  const [personQuery, setPersonQuery] = useState('')
  const [_newPersonMode, setNewPersonMode] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const assignInputRef = useRef<HTMLInputElement>(null)
  const version = usePeopleVersion()

  const loadRegions = useCallback(async () => {
    try {
      const r = await listFaceRegions(tagStorageKey)
      setRegions(r)
    } catch { /* ignore */ }
  }, [tagStorageKey])

  const loadPeople = useCallback(async () => {
    try {
      const p = await listPeople()
      setPeople(p)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!active) return
    void loadRegions()
    void loadPeople()
  }, [active, tagStorageKey, loadRegions, loadPeople, version])

  const toNormalized = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = imgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    const x = (clientX - rect.left) / rect.width
    const y = (clientY - rect.top) / rect.height
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }
  }, [imgRef])

  const onMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return
    const pt = toNormalized(e.clientX, e.clientY)
    if (!pt) return
    e.preventDefault()
    setDraft({ startX: pt.x, startY: pt.y, currentX: pt.x, currentY: pt.y })
  }, [toNormalized])

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!draft) return
    const pt = toNormalized(e.clientX, e.clientY)
    if (!pt) return
    setDraft(prev => prev ? { ...prev, currentX: pt.x, currentY: pt.y } : null)
  }, [draft, toNormalized])

  const onMouseUp = useCallback(async () => {
    if (!draft) return
    const x = Math.min(draft.startX, draft.currentX)
    const y = Math.min(draft.startY, draft.currentY)
    const w = Math.abs(draft.currentX - draft.startX)
    const h = Math.abs(draft.currentY - draft.startY)
    setDraft(null)

    if (w < 0.02 || h < 0.02) return

    try {
      const region = await createFaceRegion({
        relPath: tagStorageKey,
        x, y, w, h,
        source: 'manual',
      })
      setRegions(prev => [...prev, region])
      setAssigningId(region.id)
      setPersonQuery('')
      setNewPersonMode(false)
      requestAnimationFrame(() => assignInputRef.current?.focus())
    } catch { /* ignore */ }
  }, [draft, tagStorageKey])

  useEffect(() => {
    if (!draft) return
    const up = () => void onMouseUp()
    const move = (e: MouseEvent) => onMouseMove(e)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [draft, onMouseMove, onMouseUp])

  const assignPerson = useCallback(async (regionId: number, personId: number) => {
    try {
      const region = regions.find(r => r.id === regionId)
      if (!region) return
      const updated = await updateFaceRegion(regionId, {
        personId,
        x: region.x,
        y: region.y,
        w: region.w,
        h: region.h,
        source: region.source === 'auto' ? 'confirmed' : region.source,
      })
      setRegions(prev => prev.map(r => r.id === regionId ? updated : r))
      setAssigningId(null)
      setPersonQuery('')
    } catch { /* ignore */ }
  }, [regions])

  const handleCreateAndAssign = useCallback(async (regionId: number, name: string) => {
    try {
      const person = await createPerson(name)
      await assignPerson(regionId, person.id)
      setNewPersonMode(false)
    } catch { /* ignore */ }
  }, [assignPerson])

  const handleDeleteRegion = useCallback(async (id: number) => {
    try {
      await deleteFaceRegion(id)
      setRegions(prev => prev.filter(r => r.id !== id))
      if (assigningId === id) setAssigningId(null)
    } catch { /* ignore */ }
  }, [assigningId])

  const filteredPeople = personQuery.trim()
    ? people.filter(p => p.name.toLowerCase().includes(personQuery.toLowerCase()))
    : people

  if (!active) {
    return (
      <button
        type="button"
        class="absolute bottom-2 left-2 z-10 rounded-md border border-zinc-600 bg-zinc-900/90 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
        onClick={() => setActive(true)}
      >
        Faces
      </button>
    )
  }

  const img = imgRef.current
  if (!img) return null
  const rect = img.getBoundingClientRect()
  const parentRect = img.parentElement?.getBoundingClientRect()
  if (!parentRect) return null

  const offsetLeft = rect.left - parentRect.left
  const offsetTop = rect.top - parentRect.top

  return (
    <>
      {/* Toggle off */}
      <button
        type="button"
        class="absolute bottom-2 left-2 z-10 rounded-md border border-sky-500 bg-sky-600/90 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-500"
        onClick={() => { setActive(false); setAssigningId(null) }}
      >
        Faces (on)
      </button>

      {/* SVG overlay on the image */}
      <svg
        ref={svgRef}
        class="absolute z-[5]"
        style={{
          left: `${offsetLeft}px`,
          top: `${offsetTop}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          cursor: 'crosshair',
        }}
        onMouseDown={onMouseDown}
      >
        {/* Existing regions */}
        {regions.map(r => {
          if (r.x == null || r.y == null || r.w == null || r.h == null) return null
          const isAssigning = assigningId === r.id
          return (
            <g key={r.id}>
              <rect
                x={`${r.x * 100}%`}
                y={`${r.y * 100}%`}
                width={`${r.w * 100}%`}
                height={`${r.h * 100}%`}
                fill="none"
                stroke={r.personId ? '#38bdf8' : '#fbbf24'}
                stroke-width="2"
                rx="3"
                class={isAssigning ? 'animate-pulse' : ''}
                style={{ cursor: 'pointer' }}
                onClick={(e: MouseEvent) => {
                  e.stopPropagation()
                  setAssigningId(isAssigning ? null : r.id)
                  setPersonQuery('')
                  setNewPersonMode(false)
                  if (!isAssigning) {
                    requestAnimationFrame(() => assignInputRef.current?.focus())
                  }
                }}
              />
              {r.personName ? (
                <text
                  x={`${(r.x + r.w / 2) * 100}%`}
                  y={`${r.y * 100}%`}
                  dy="-4"
                  text-anchor="middle"
                  fill="white"
                  font-size="11"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)', pointerEvents: 'none' }}
                >
                  {r.personName}
                </text>
              ) : null}
            </g>
          )
        })}

        {/* Draft box while drawing */}
        {draft ? (
          <rect
            x={`${Math.min(draft.startX, draft.currentX) * 100}%`}
            y={`${Math.min(draft.startY, draft.currentY) * 100}%`}
            width={`${Math.abs(draft.currentX - draft.startX) * 100}%`}
            height={`${Math.abs(draft.currentY - draft.startY) * 100}%`}
            fill="rgba(56, 189, 248, 0.15)"
            stroke="#38bdf8"
            stroke-width="2"
            stroke-dasharray="4 2"
            rx="3"
          />
        ) : null}
      </svg>

      {/* Assignment popover */}
      {assigningId !== null ? (() => {
        const region = regions.find(r => r.id === assigningId)
        if (!region || region.x == null || region.y == null || region.w == null) return null
        const popoverLeft = offsetLeft + (region.x + region.w / 2) * rect.width
        const popoverTop = offsetTop + (region.y + region.h!) * rect.height + 8
        return (
          <div
            class="absolute z-20 w-56 rounded-lg border border-zinc-600 bg-zinc-900 p-2 shadow-xl"
            style={{ left: `${popoverLeft}px`, top: `${popoverTop}px`, transform: 'translateX(-50%)' }}
            onClick={(e: MouseEvent) => e.stopPropagation()}
          >
            <div class="mb-1.5 flex items-center justify-between">
              <span class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                {region.personName ? 'Reassign' : 'Who is this?'}
              </span>
              <button
                type="button"
                class="text-[10px] text-red-400 hover:text-red-300"
                onClick={() => void handleDeleteRegion(assigningId)}
              >
                Delete region
              </button>
            </div>
            <input
              ref={assignInputRef}
              type="text"
              placeholder="Search or type name…"
              value={personQuery}
              onInput={e => {
                setPersonQuery((e.target as HTMLInputElement).value)
                setNewPersonMode(false)
              }}
              onKeyDown={e => {
                if (e.key === 'Escape') { setAssigningId(null); e.stopPropagation() }
                if (e.key === 'Enter' && filteredPeople.length === 1) {
                  void assignPerson(assigningId, filteredPeople[0]!.id)
                } else if (e.key === 'Enter' && personQuery.trim() && filteredPeople.length === 0) {
                  void handleCreateAndAssign(assigningId, personQuery.trim())
                }
              }}
              class="mb-1.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
            />
            <ul class="max-h-32 overflow-y-auto">
              {filteredPeople.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    class="w-full rounded px-2 py-1 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                    onClick={() => void assignPerson(assigningId, p.id)}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
              {personQuery.trim() && filteredPeople.length === 0 ? (
                <li>
                  <button
                    type="button"
                    class="w-full rounded px-2 py-1 text-left text-sm text-sky-400 hover:bg-zinc-800"
                    onClick={() => void handleCreateAndAssign(assigningId, personQuery.trim())}
                  >
                    Create "{personQuery.trim()}"
                  </button>
                </li>
              ) : null}
            </ul>
            {region.personName ? (
              <div class="mt-1 border-t border-zinc-800 pt-1">
                <span class="text-[10px] text-zinc-500">
                  Currently: <span class="text-zinc-300">{region.personName}</span>
                </span>
              </div>
            ) : null}
          </div>
        )
      })() : null}
    </>
  )
}

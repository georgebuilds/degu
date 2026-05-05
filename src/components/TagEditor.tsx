import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks'

type TagEditorProps = {
  tags: string[]
  onChange: (next: string[]) => void
  /** Focus the add-tags input when mounted (e.g. opening Edit tags from the menu). */
  autoFocus?: boolean
  /** Tags to offer as native autocomplete (index + recent); current tags excluded. */
  suggestionTags?: string[]
}

export function TagEditor({
  tags,
  onChange,
  autoFocus,
  suggestionTags = [],
}: TagEditorProps) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const rawId = useId()
  const datalistId = useMemo(
    () => `tag-ac-${rawId.replaceAll(':', '')}`,
    [rawId]
  )

  const datalistOptions = useMemo(() => {
    const tagSet = new Set(tags)
    const out = new Set<string>()
    for (const t of suggestionTags) {
      const u = t.trim()
      if (u && !tagSet.has(u)) out.add(u)
    }
    return [...out].sort((a, b) => a.localeCompare(b))
  }, [suggestionTags, tags])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const commit = useCallback(
    (raw: string) => {
      const parts = raw
        .split(/[,]+/u)
        .map(s => s.trim())
        .filter(Boolean)
      if (parts.length === 0) return
      const next = [...tags]
      for (const p of parts) {
        if (!next.includes(p)) next.push(p)
      }
      onChange(next)
      setDraft('')
    },
    [tags, onChange]
  )

  return (
    <div class="flex flex-wrap items-center gap-1.5">
      <input
        ref={inputRef}
        type="text"
        class="min-w-[8rem] flex-1 rounded-md border border-zinc-600/80 bg-zinc-900/60 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        placeholder="Add tags…"
        value={draft}
        list={datalistOptions.length > 0 ? datalistId : undefined}
        autoComplete="off"
        onInput={e => setDraft((e.target as HTMLInputElement).value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === ',') {
            e.preventDefault()
            commit(draft)
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft)
        }}
      />
      {datalistOptions.length > 0 ? (
        <datalist id={datalistId}>
          {datalistOptions.map(t => (
            <option key={t} value={t} />
          ))}
        </datalist>
      ) : null}
    </div>
  )
}

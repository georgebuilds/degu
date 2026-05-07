import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  basenameFromRelativePath,
  isSupportedMediaFile,
} from '../lib/supported-media'
import { getRecentTags, recordTagApplied } from '../lib/recent-tags'
import { getDistinctTagsFromIndex, getTags, setTags } from '../lib/tags'
import { TagEditor } from './TagEditor.tsx'
import { useFocusTrap } from '../lib/use-focus-trap'
import { useModalEscape } from './use-modal-stack.ts'

type TagsModalProps = {
  /**
   * Path(s) relative to connected root; unique tag storage keys.
   * Multiple keys: one shared tag list is applied to every file (union loaded, same set saved for each).
   */
  tagStorageKeys: string[]
  onClose: () => void
  onSaved: (
    tagStorageKey: string,
    previousTags: string[],
    nextTags: string[]
  ) => void
}

function unionSortedTags(keys: string[]): string[] {
  const seen = new Set<string>()
  for (const k of keys) {
    for (const t of getTags(k)) {
      const u = t.trim()
      if (u) seen.add(u)
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

export function TagsModal({
  tagStorageKeys,
  onClose,
  onSaved,
}: TagsModalProps) {
  const [tags, setTagsState] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastPersistedRef = useRef<string[]>([])
  useFocusTrap(dialogRef, true)
  const primaryKey = tagStorageKeys[0] ?? ''
  const baseName = basenameFromRelativePath(primaryKey)
  const tagsAllowed =
    tagStorageKeys.length > 0 &&
    tagStorageKeys.every(k => isSupportedMediaFile(basenameFromRelativePath(k)))
  const keysJoined = useMemo(() => tagStorageKeys.join('\0'), [tagStorageKeys])

  useEffect(() => {
    if (tagStorageKeys.length === 0) {
      setTagsState([])
      setLoading(false)
      return
    }
    if (!tagsAllowed) {
      setTagsState([])
      setLoading(false)
      return
    }
    const initial =
      tagStorageKeys.length === 1
        ? getTags(tagStorageKeys[0]!)
        : unionSortedTags(tagStorageKeys)
    setTagsState(initial)
    lastPersistedRef.current = initial
    setLoading(false)
  }, [keysJoined, tagsAllowed])

  useModalEscape(true, onClose)

  const persist = useCallback(
    (next: string[]) => {
      const previous = lastPersistedRef.current
      for (const t of next) {
        if (!previous.includes(t)) recordTagApplied(t)
      }
      if (tagStorageKeys.length === 1) {
        const key = tagStorageKeys[0]!
        setTags(key, next)
        setTagsState(next)
        lastPersistedRef.current = next
        onSaved(key, previous, next)
        return
      }
      setTagsState(next)
      lastPersistedRef.current = next
      for (const key of tagStorageKeys) {
        const prev = getTags(key)
        setTags(key, next)
        onSaved(key, prev, next)
      }
    },
    [tagStorageKeys, onSaved]
  )

  const removeTag = useCallback(
    (tag: string) => {
      persist(lastPersistedRef.current.filter(t => t !== tag))
    },
    [persist]
  )

  const tagSuggestions = useMemo(() => {
    const merged = new Set<string>(getDistinctTagsFromIndex())
    for (const t of getRecentTags()) {
      const u = t.trim()
      if (u) merged.add(u)
    }
    return [...merged].sort((a, b) => a.localeCompare(b))
  }, [tags])

  const title =
    tagStorageKeys.length <= 1
      ? 'Tags'
      : `Tags (${tagStorageKeys.length} files)`

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tags-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={dialogRef} class="w-full max-w-md rounded-xl border border-zinc-600 bg-zinc-950 p-5 shadow-2xl">
        <h2
          id="tags-modal-title"
          class="mb-1 truncate text-lg font-semibold text-zinc-100"
          title={primaryKey}
        >
          {title}
        </h2>
        <p class="mb-4 break-all text-sm text-zinc-500" title={primaryKey}>
          {tagStorageKeys.length <= 1
            ? primaryKey
            : 'The list below is the union of tags on the selected files. Saving applies this exact set to every selected file.'}
        </p>

        {!tagsAllowed ? (
          <p class="py-4 text-sm text-zinc-500">
            Tags apply only to supported images, GIFs, and videos ({baseName} is
            not a supported extension).
          </p>
        ) : loading ? (
          <p class="py-8 text-center text-sm text-zinc-500">Loading…</p>
        ) : (
          <>
            <div class="mb-3 flex min-h-[2.5rem] flex-wrap gap-1.5">
              {tags.length === 0 ? (
                <span class="text-sm text-zinc-500">No tags yet.</span>
              ) : (
                tags.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    class="rounded-full border border-zinc-600 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:border-rose-500/80 hover:bg-rose-950/40 hover:text-rose-200"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() => removeTag(tag)}
                  >
                    {tag} ×
                  </button>
                ))
              )}
            </div>
            <TagEditor
              key={tagStorageKeys.join('\0')}
              tags={tags}
              autoFocus
              suggestionTags={tagSuggestions}
              onChange={next => {
                persist(next)
              }}
            />
            <p class="mt-2 text-xs text-zinc-600">
              Type tags and press Enter or comma to add. Suggestions include tags
              from other files in this folder and your recent quick-add list.
              {tagStorageKeys.length > 1
                ? ' Edits replace the full tag list on each selected file.'
                : ''}
            </p>
          </>
        )}

        <div class="mt-6 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-zinc-600 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

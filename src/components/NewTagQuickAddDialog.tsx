import type { RefObject } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

type NewTagQuickAddDialogProps = {
  open: boolean
  onClose: () => void
  onSubmit: (tag: string) => void
  /** Focus target after close (keyboard UX). */
  triggerRef?: RefObject<HTMLButtonElement | null>
}

export function NewTagQuickAddDialog({
  open,
  onClose,
  onSubmit,
  triggerRef,
}: NewTagQuickAddDialogProps) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setDraft('')
    queueMicrotask(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        queueMicrotask(() => triggerRef?.current?.focus())
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose, triggerRef])

  if (!open) return null

  const focusTrigger = () => {
    queueMicrotask(() => triggerRef?.current?.focus())
  }

  const commit = () => {
    const t = draft.trim()
    if (!t) return
    onSubmit(t)
    setDraft('')
    onClose()
    focusTrigger()
  }

  const cancel = () => {
    onClose()
    focusTrigger()
  }

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={e => {
        if (e.target === e.currentTarget) cancel()
      }}
    >
      <div
        class="w-full max-w-sm rounded-xl border border-zinc-600 bg-zinc-950 p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="New tag"
        onClick={e => e.stopPropagation()}
      >
        <h3 class="mb-3 text-sm font-medium text-zinc-100">New tag</h3>
        <input
          ref={inputRef}
          type="text"
          class="mb-3 w-full rounded-md border border-zinc-600/80 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          placeholder="Tag name"
          value={draft}
          autoComplete="off"
          onInput={e => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
            onClick={cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!draft.trim()}
            onClick={commit}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

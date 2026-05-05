import { type ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

type MoreTagsQuickAddDropdownProps = {
  tags: readonly string[]
  onSelect: (tag: string) => void
  /** Submenu opens to the right of the trigger (menus) or below (pills). */
  placement: 'right' | 'below'
  /** z-index for the floating panel (e.g. context menu vs modal). */
  panelZClass: string
  triggerClassName: string
  panelClassName: string
  optionClassName: string
  /** Screen reader label for the listbox. */
  ariaLabel?: string
  /** Prefix for each option label (e.g. "+ "). */
  optionPrefix?: string
  triggerChildren: ComponentChildren
}

/**
 * Controlled “More tags” submenu. Avoids nested `details` (unreliable inside
 * menus) and closes on outside click / Escape (capture, so parent dialogs stay open).
 */
export function MoreTagsQuickAddDropdown({
  tags,
  onSelect,
  placement,
  panelZClass,
  triggerClassName,
  panelClassName,
  optionClassName,
  ariaLabel = 'More tags',
  optionPrefix = '',
  triggerChildren,
}: MoreTagsQuickAddDropdownProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (tags.length === 0) return null

  const positionClass =
    placement === 'right'
      ? 'absolute left-full top-0 ml-0.5'
      : 'absolute left-0 top-full mt-1'

  return (
    <div ref={rootRef} class="relative">
      <button
        type="button"
        class={triggerClassName}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(o => !o)}
      >
        {triggerChildren}
      </button>
      {open ? (
        <div
          class={`${positionClass} ${panelZClass} ${panelClassName}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {tags.map(tag => (
            <button
              key={tag}
              type="button"
              class={optionClassName}
              role="option"
              onClick={() => {
                onSelect(tag)
                setOpen(false)
              }}
            >
              {optionPrefix}
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

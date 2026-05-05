import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import type { ComponentChildren } from 'preact'

type FileContextMenuProps = {
  x: number
  y: number
  onClose: () => void
  children: ComponentChildren
}

export function FileContextMenu({
  x,
  y,
  onClose,
  children,
}: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      const el = ref.current
      if (el && !el.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad
    }
    if (left < pad) left = pad
    if (top < pad) top = pad
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [x, y])

  return (
    <div
      ref={ref}
      class="fixed z-[55] min-w-[10rem] rounded-lg border border-zinc-600 bg-zinc-900 py-1 shadow-xl"
      style={{ left: 0, top: 0 }}
      role="menu"
    >
      {children}
    </div>
  )
}

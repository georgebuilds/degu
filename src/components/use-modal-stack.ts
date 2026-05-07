import { useEffect, useRef, useState } from 'preact/hooks'

const stack: string[] = []
let counter = 0
const topListeners = new Set<() => void>()

function push(id: string): void {
  stack.push(id)
  notifyTopChanged()
}

function remove(id: string): void {
  const i = stack.lastIndexOf(id)
  if (i !== -1) stack.splice(i, 1)
  if (stack.length === 0) counter = 0
  notifyTopChanged()
}

function isTop(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}

function notifyTopChanged(): void {
  for (const fn of topListeners) fn()
}

/**
 * Register a modal with the global stack while `active` is true and run
 * `onEscape` only when this modal is the topmost one. Lets stacked dialogs
 * dismiss one layer at a time instead of all closing on a single Esc.
 *
 * Returns an `isTopOfStack` flag so callers can gate other window-level
 * keyboard handlers (e.g. arrow-key navigation) on whether they're the
 * topmost modal.
 */
export function useModalEscape(
  active: boolean,
  onEscape: () => void
): { isTopOfStack: boolean } {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape
  const idRef = useRef<string | null>(null)
  const [isTopOfStack, setIsTopOfStack] = useState(false)

  useEffect(() => {
    if (!active) {
      setIsTopOfStack(false)
      return
    }
    const id = `modal-${++counter}`
    idRef.current = id
    push(id)
    const recompute = () => setIsTopOfStack(isTop(id))
    recompute()
    topListeners.add(recompute)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!isTop(id)) return
      e.stopPropagation()
      onEscapeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      topListeners.delete(recompute)
      remove(id)
      idRef.current = null
    }
  }, [active])

  return { isTopOfStack }
}

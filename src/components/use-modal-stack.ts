import { useEffect } from 'preact/hooks'

const stack: string[] = []
let counter = 0

function push(id: string): void {
  stack.push(id)
}

function remove(id: string): void {
  const i = stack.lastIndexOf(id)
  if (i !== -1) stack.splice(i, 1)
}

function isTop(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}

/**
 * Register a modal with the global stack while `active` is true and run
 * `onEscape` only when this modal is the topmost one. Lets stacked dialogs
 * dismiss one layer at a time instead of all closing on a single Esc.
 */
export function useModalEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return
    const id = `modal-${++counter}`
    push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!isTop(id)) return
      e.stopPropagation()
      onEscape()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      remove(id)
    }
  }, [active, onEscape])
}

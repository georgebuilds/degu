/** @vitest-environment happy-dom */
import { render, cleanup } from '@testing-library/preact'
import { h } from 'preact'
import { useRef } from 'preact/hooks'
import { afterEach, describe, expect, it } from 'vitest'
import { useFocusTrap } from './use-focus-trap'

function Trap({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useFocusTrap(ref, active)
  return h(
    'div',
    { ref },
    h('button', { id: 'first' }, 'first'),
    h('button', { id: 'mid' }, 'mid'),
    h('button', { id: 'last' }, 'last')
  )
}

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement
}

function tab(opts: { shift?: boolean } = {}) {
  // Dispatch from the focused element so the event bubbles to the trap
  // container's keydown listener (mirrors real browser behaviour).
  const target = (document.activeElement ?? document.body) as HTMLElement
  const ev = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: opts.shift ?? false,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(ev)
  return ev
}

describe('useFocusTrap', () => {
  afterEach(() => cleanup())

  it('focuses the first focusable element when activated', () => {
    render(h(Trap, { active: true }))
    expect(document.activeElement).toBe(byId('first'))
  })

  it('does nothing when inactive', () => {
    const before = document.activeElement
    render(h(Trap, { active: false }))
    expect(document.activeElement).toBe(before)
  })

  it('wraps focus from last to first on Tab', () => {
    render(h(Trap, { active: true }))
    byId('last').focus()
    const ev = tab()
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(byId('first'))
  })

  it('wraps focus from first to last on Shift+Tab', () => {
    render(h(Trap, { active: true }))
    byId('first').focus()
    const ev = tab({ shift: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(byId('last'))
  })

  it('does not trap when Tab is pressed in the middle', () => {
    render(h(Trap, { active: true }))
    byId('mid').focus()
    const ev = tab()
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(byId('mid'))
  })

  it('ignores non-Tab keys', () => {
    render(h(Trap, { active: true }))
    const last = byId('last')
    last.focus()
    const ev = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    last.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(last)
  })

  it('Shift+Tab wraps to last when focus has escaped the container', () => {
    render(h(Trap, { active: true }))
    const container = byId('first').parentElement as HTMLElement
    // Move focus outside the trap container.
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    // Dispatch on the container itself (focus escaped, so nothing inside to
    // bubble from). The handler sees activeEl not contained → wraps to last.
    const ev = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    container.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(byId('last'))
    outside.remove()
  })

  it('restores focus to the previously focused element on deactivate', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { rerender } = render(h(Trap, { active: true }))
    expect(document.activeElement).toBe(byId('first'))

    rerender(h(Trap, { active: false }))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

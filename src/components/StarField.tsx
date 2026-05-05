import { useEffect, useRef } from 'preact/hooks'

type StarFieldProps = {
  /** How many stars to scatter. Default 90 — same density as the landing page. */
  density?: number
  /** Class hook on the wrapping <svg>; the field defaults to fixed/inset-0. */
  class?: string
}

/**
 * Ambient star field that mirrors the landing page sky. Mounted once in App
 * behind every screen; AppShell's solid horizon-tone surface covers it
 * during normal use, so the stars are only seen on loading / error /
 * intentionally-empty states. That's the "atmosphere bleeds through when
 * nothing else is on top" idea — same trick the landing page uses.
 */
export function StarField({ density = 90, class: className }: StarFieldProps) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = ref.current
    if (!svg || svg.children.length > 0) return
    const ns = 'http://www.w3.org/2000/svg'
    for (let i = 0; i < density; i++) {
      const c = document.createElementNS(ns, 'circle')
      const x = Math.random() * 100
      // Bias toward the upper portion so the warm horizon stays clean.
      const y = Math.pow(Math.random(), 1.6) * 72
      const big = Math.random() < 0.06
      const r = big ? 0.45 + Math.random() * 0.35 : 0.16 + Math.random() * 0.3
      const o = 0.28 + Math.random() * 0.65
      c.setAttribute('cx', x.toFixed(2))
      c.setAttribute('cy', y.toFixed(2))
      c.setAttribute('r', r.toFixed(3))
      c.setAttribute('fill', big ? '#ffeed0' : '#efe7d7')
      c.setAttribute('opacity', o.toFixed(2))
      c.style.setProperty('--star-o', o.toFixed(2))
      c.style.setProperty('--star-d', `${(3 + Math.random() * 5).toFixed(2)}s`)
      c.style.setProperty('--star-delay', `${(Math.random() * -8).toFixed(2)}s`)
      svg.appendChild(c)
    }
  }, [density])

  return (
    <svg
      ref={ref}
      class={`star-field pointer-events-none fixed inset-0 z-0 ${className ?? ''}`}
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
      aria-hidden="true"
    />
  )
}

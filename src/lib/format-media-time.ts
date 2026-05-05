/** Format seconds as m:ss or h:mm:ss for UI labels. */
export function formatMediaTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  const ss = s.toString().padStart(2, '0')
  const mm = m.toString().padStart(2, '0')
  if (h > 0) return `${h}:${mm}:${ss}`
  return `${m}:${ss}`
}

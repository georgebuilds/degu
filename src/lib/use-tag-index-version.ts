import { useEffect, useState } from 'preact/hooks'
import { getTagIndexVersion, subscribeTagIndexVersion } from './tags'

/**
 * Subscribed view of the tag-index mutation counter. Use as a dep in
 * `useMemo` deps to refresh aggregates after a session-internal tag edit
 * (sidebar counts, distinct-tags lists, stale-files counts, etc).
 */
export function useTagIndexVersion(): number {
  const [v, setV] = useState(() => getTagIndexVersion())
  useEffect(() => subscribeTagIndexVersion(() => setV(getTagIndexVersion())), [])
  return v
}

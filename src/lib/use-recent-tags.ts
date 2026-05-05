import { useEffect, useState } from 'preact/hooks'
import { getRecentTags, subscribeRecentTags } from './recent-tags'

/** Subscribed view of the recent-tags MRU list. Re-renders on recordTagApplied. */
export function useRecentTags(): string[] {
  const [tags, setTags] = useState<string[]>(() => getRecentTags())
  useEffect(() => subscribeRecentTags(() => setTags(getRecentTags())), [])
  return tags
}

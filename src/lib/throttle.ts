/** Fire at most once per `ms`. */
export function throttleVoid(fn: () => void, ms: number): () => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    const now = Date.now()
    const run = () => {
      last = Date.now()
      fn()
      timer = null
    }
    if (now - last >= ms) {
      run()
      return
    }
    if (timer !== null) return
    timer = setTimeout(() => run(), ms - (now - last))
  }
}

/** Like Promise.all + map but limits concurrent in-flight promises. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}

/** Fire at most once per `ms` with the latest argument. */
export function throttle<T>(fn: (arg: T) => void, ms: number): (arg: T) => void {
  let last = 0
  let pending: T | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  return (arg: T) => {
    const now = Date.now()
    const run = () => {
      last = Date.now()
      fn(arg)
      pending = null
      timer = null
    }
    if (now - last >= ms) {
      run()
      return
    }
    pending = arg
    if (timer !== null) return
    timer = setTimeout(() => {
      if (pending !== null) fn(pending)
      last = Date.now()
      pending = null
      timer = null
    }, ms - (now - last))
  }
}

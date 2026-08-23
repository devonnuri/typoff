export const CURSOR_LOOKUP_DEBOUNCE_MS = 250

const CURSOR_CACHE_CAPACITY = 16

/**
 * Debounce + LRU cache for preview cursor-to-page lookups.
 *
 * `request` decides whether a click may start an actual (compile-heavy)
 * lookup: requests arriving within {@link CURSOR_LOOKUP_DEBOUNCE_MS} of the
 * last proceeded lookup are absorbed so rapid clicks do not spam the serial
 * compile queue. Identical keys within the window are always absorbed.
 *
 * `remember`/`cached` form a small LRU cache (capacity 16) keyed by
 * `` `${contentLength}:${offset}` `` so repeated clicks at the same spot skip
 * the lookup entirely.
 */
export class CursorLookupThrottle {
  private lastProceededAt = Number.NEGATIVE_INFINITY
  private readonly cache = new Map<string, number>()

  /**
   * Returns true when the caller should proceed with an actual lookup now,
   * false when the request was absorbed by the debounce window. The key is
   * part of the signature for future per-key policies; the current debounce
   * is time-based only.
   */
  request(_key: string): boolean {
    const now = Date.now()
    if (now - this.lastProceededAt < CURSOR_LOOKUP_DEBOUNCE_MS) {
      return false
    }
    this.lastProceededAt = now
    return true
  }

  /** Records a successful lookup result and refreshes LRU recency. */
  remember(key: string, pageIndex: number): void {
    this.cache.delete(key)
    this.cache.set(key, pageIndex)
    while (this.cache.size > CURSOR_CACHE_CAPACITY) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.cache.delete(oldest)
    }
  }

  /** Returns the cached page for the key, refreshing recency. */
  cached(key: string): number | undefined {
    const pageIndex = this.cache.get(key)
    if (pageIndex === undefined) {
      return undefined
    }
    this.cache.delete(key)
    this.cache.set(key, pageIndex)
    return pageIndex
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CURSOR_LOOKUP_DEBOUNCE_MS,
  CursorLookupThrottle,
} from './cursorLookup'

describe('CursorLookupThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('debounce', () => {
    it('proceeds the first request', () => {
      const throttle = new CursorLookupThrottle()
      expect(throttle.request('10:5')).toBe(true)
    })

    it('absorbs requests within the debounce window', () => {
      const throttle = new CursorLookupThrottle()
      expect(throttle.request('10:5')).toBe(true)
      vi.advanceTimersByTime(CURSOR_LOOKUP_DEBOUNCE_MS - 1)
      expect(throttle.request('10:9')).toBe(false)
    })

    it('always absorbs an identical key within the window', () => {
      const throttle = new CursorLookupThrottle()
      expect(throttle.request('10:5')).toBe(true)
      vi.advanceTimersByTime(CURSOR_LOOKUP_DEBOUNCE_MS - 1)
      expect(throttle.request('10:5')).toBe(false)
    })

    it('proceeds again once the window has elapsed', () => {
      const throttle = new CursorLookupThrottle()
      expect(throttle.request('10:5')).toBe(true)
      vi.advanceTimersByTime(CURSOR_LOOKUP_DEBOUNCE_MS)
      expect(throttle.request('10:5')).toBe(true)
    })

    it('distinct keys do not absorb each other across windows', () => {
      const throttle = new CursorLookupThrottle()
      expect(throttle.request('a')).toBe(true)
      vi.advanceTimersByTime(CURSOR_LOOKUP_DEBOUNCE_MS + 1)
      expect(throttle.request('b')).toBe(true)
      vi.advanceTimersByTime(CURSOR_LOOKUP_DEBOUNCE_MS + 1)
      expect(throttle.request('c')).toBe(true)
    })
  })

  describe('cache', () => {
    it('returns undefined for unknown keys', () => {
      const throttle = new CursorLookupThrottle()
      expect(throttle.cached('10:5')).toBeUndefined()
    })

    it('remembers and returns a cached page', () => {
      const throttle = new CursorLookupThrottle()
      throttle.remember('10:5', 3)
      expect(throttle.cached('10:5')).toBe(3)
    })

    it('updates an existing entry', () => {
      const throttle = new CursorLookupThrottle()
      throttle.remember('10:5', 3)
      throttle.remember('10:5', 7)
      expect(throttle.cached('10:5')).toBe(7)
    })

    it('evicts the least recently used entry beyond capacity 16', () => {
      const throttle = new CursorLookupThrottle()
      for (let i = 0; i < 16; i += 1) {
        throttle.remember(`len:${i}`, i)
      }
      // Touch entry 0 so entry 1 becomes the least recently used.
      expect(throttle.cached('len:0')).toBe(0)
      throttle.remember('len:16', 16)
      expect(throttle.cached('len:1')).toBeUndefined()
      expect(throttle.cached('len:0')).toBe(0)
      expect(throttle.cached('len:16')).toBe(16)
    })
  })
})

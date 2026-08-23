import { beforeEach, describe, expect, it } from 'vitest'
import {
  getPreviewPolicy,
  recordCompileDuration,
  resetPreviewPolicyForTest,
} from './previewPolicy'

describe('getPreviewPolicy', () => {
  describe('cold start (no measured samples)', () => {
    beforeEach(() => {
      resetPreviewPolicyForTest()
    })

    it('keeps automatic preview responsive for normal files', () => {
      expect(getPreviewPolicy(10_000)).toEqual({ auto: true, delayMs: 400 })
    })

    it('uses a longer debounce for medium files', () => {
      expect(getPreviewPolicy(18_000)).toEqual({ auto: true, delayMs: 1_200 })
    })

    it('requires an explicit render for long files', () => {
      expect(getPreviewPolicy(20_001)).toEqual({ auto: false, delayMs: 0 })
    })
  })

  describe('measured compile latency', () => {
    beforeEach(() => {
      resetPreviewPolicyForTest()
    })

    it('measured fast compiles beat the long-file heuristic', () => {
      recordCompileDuration(100)
      expect(getPreviewPolicy(999_999)).toEqual({ auto: true, delayMs: 200 })
    })

    it('measured slow compiles disable auto preview', () => {
      recordCompileDuration(4_000)
      expect(getPreviewPolicy(10)).toEqual({ auto: false, delayMs: 0 })
    })

    it('smooths durations with an EMA', () => {
      recordCompileDuration(100)
      // EMA = 0.3 * 1000 + 0.7 * 100 = 370ms → medium band
      recordCompileDuration(1_000)
      expect(getPreviewPolicy(10)).toEqual({ auto: true, delayMs: 400 })
    })

    it('uses a short debounce for fast measured compiles', () => {
      recordCompileDuration(50)
      expect(getPreviewPolicy(10)).toEqual({ auto: true, delayMs: 200 })
    })

    it('uses a long debounce for slow-but-tolerable compiles', () => {
      recordCompileDuration(2_000)
      expect(getPreviewPolicy(10)).toEqual({ auto: true, delayMs: 1_200 })
    })

    it('reset clears recorded samples', () => {
      recordCompileDuration(4_000)
      resetPreviewPolicyForTest()
      expect(getPreviewPolicy(10)).toEqual({ auto: true, delayMs: 400 })
    })
  })
})

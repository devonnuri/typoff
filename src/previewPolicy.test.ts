import { describe, expect, it } from 'vitest'
import { getPreviewPolicy } from './previewPolicy'

describe('getPreviewPolicy', () => {
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

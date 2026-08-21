import { describe, expect, it } from 'vitest'
import {
  cropSvgToPage,
  createDocumentRequestGate,
  createPageLruCache,
  normalizePageOffsets,
} from './virtualPreview'

it('invalidates queued page work as soon as a newer compile is requested', () => {
  const gate = createDocumentRequestGate()
  const oldPageEpoch = gate.capture()
  const newCompileEpoch = gate.startCompile()

  expect(gate.isCurrent(oldPageEpoch)).toBe(false)
  expect(gate.isCurrent(newCompileEpoch)).toBe(true)
})

it('turns renderer page ordinals into cumulative SVG offsets', () => {
  expect(
    normalizePageOffsets([
      { pageOffset: 0, width: 780, height: 1080 },
      { pageOffset: 1, width: 600, height: 900 },
      { pageOffset: 2, width: 780, height: 1080 },
    ]),
  ).toEqual([
    { pageOffset: 0, width: 780, height: 1080 },
    { pageOffset: 1080, width: 600, height: 900 },
    { pageOffset: 1980, width: 780, height: 1080 },
  ])
})

describe('page SVG cropping', () => {
  it('rebases the SVG viewport and intrinsic size to one page', () => {
    const svg = '<svg viewBox="0 0 780 109080" width="780" height="109080" data-width="780" data-height="109080"><g /></svg>'

    expect(cropSvgToPage(svg, { pageOffset: 2160, width: 780, height: 1080 })).toBe(
      '<svg viewBox="0 2160 780 1080" width="780" height="1080" data-width="780" data-height="1080"><g /></svg>',
    )
  })
})

describe('page preview LRU', () => {
  it('keeps at most six pages and revokes evicted and cleared URLs', () => {
    const revoked: string[] = []
    const cache = createPageLruCache(6, (url: string) => revoked.push(url))

    for (let page = 0; page < 7; page += 1) {
      cache.set(page, `blob:${page}`)
    }
    expect(cache.keys()).toEqual([1, 2, 3, 4, 5, 6])
    expect(revoked).toEqual(['blob:0'])

    expect(cache.get(1)).toBe('blob:1')
    cache.set(7, 'blob:7')
    expect(cache.keys()).toEqual([3, 4, 5, 6, 1, 7])
    expect(revoked).toEqual(['blob:0', 'blob:2'])

    cache.clear()
    expect(revoked).toEqual([
      'blob:0',
      'blob:2',
      'blob:3',
      'blob:4',
      'blob:5',
      'blob:6',
      'blob:1',
      'blob:7',
    ])
  })
})

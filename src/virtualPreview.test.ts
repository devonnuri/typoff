import { describe, expect, it } from 'vitest'
import {
  computeClickedYPt,
  cropSvgToPage,
  createDocumentRequestGate,
  createPageLruCache,
  isolateSvgPage,
  normalizePageOffsets,
  stripSvgForeignObjects,
} from './virtualPreview'

describe('preview click → source Y', () => {
  it('converts a click Y from screen pixels into document points', () => {
    // 300px below the page top at zoom 1 → 300pt.
    expect(computeClickedYPt(400, 100, 1)).toBe(300)
  })

  it('divides by zoom so higher zoom levels map to the same points', () => {
    expect(computeClickedYPt(400, 100, 2)).toBe(150)
    expect(computeClickedYPt(400, 100, 0.5)).toBe(600)
  })

  it('yields zero and negative values for clicks above the page top', () => {
    expect(computeClickedYPt(100, 100, 1)).toBe(0)
    expect(computeClickedYPt(50, 100, 1)).toBe(-50)
  })
})

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

  it('removes every non-selected page before rebasing the viewport', () => {
    const svg = [
      '<svg viewBox="0 0 780 2160" width="780" height="2160">',
      '<defs><path id="glyph" /></defs>',
      '<g class="typst-page" transform="translate(0, 0)"><text>PAGE ONE</text></g>',
      '<g class="typst-page" transform="translate(0, 1080)"><text>PAGE TWO</text></g>',
      '</svg>',
    ].join('')

    const isolated = isolateSvgPage(
      svg,
      1,
      { pageOffset: 1080, width: 780, height: 1080 },
    )

    expect(isolated).toContain('<defs><path id="glyph" /></defs>')
    expect(isolated).toContain('PAGE TWO')
    expect(isolated).toContain('transform="translate(0, 0)"')
    expect(isolated).toContain('viewBox="0 0 780 1080"')
    expect(isolated).not.toContain('PAGE ONE')
    expect(isolated.match(/class="typst-page"/g)).toHaveLength(1)
  })
})

describe('foreignObject sanitization', () => {
  it('removes foreignObject semantic overlays while preserving vector text', () => {
    const svg = [
      '<svg viewBox="0 0 780 1080" width="780" height="1080">',
      '<g class="typst-page">',
      '<g class="typst-text"><use href="#glyph-a" /></g>',
      '<foreignObject x="0" y="0" width="100" height="20"><h5:div class="tsel">Hello</h5:div></foreignObject>',
      '</g>',
      '</svg>',
    ].join('')

    const sanitized = stripSvgForeignObjects(svg)

    expect(sanitized).not.toContain('<foreignObject')
    expect(sanitized).not.toContain('Hello')
    expect(sanitized).toContain('<g class="typst-text"><use href="#glyph-a" /></g>')
  })

  it('removes self-closing foreignObject nodes', () => {
    const svg =
      '<svg><g class="typst-page"><foreignObject x="0" y="0" width="1" height="1" /></g></svg>'

    expect(stripSvgForeignObjects(svg)).toBe('<svg><g class="typst-page"></g></svg>')
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

describe('page preview LRU (byte mode)', () => {
  it('evicts oldest entries first once the byte budget is exceeded', () => {
    const revoked: string[] = []
    const cache = createPageLruCache(
      { maxBytes: 100 },
      (url: string) => revoked.push(url),
    )

    cache.set(0, 'blob:0', 40)
    cache.set(1, 'blob:1', 40)
    expect(cache.totalBytes()).toBe(80)
    expect(cache.keys()).toEqual([0, 1])

    // 40 + 40 + 30 = 110 > 100 → page 0 evicted.
    cache.set(2, 'blob:2', 30)
    expect(cache.keys()).toEqual([1, 2])
    expect(revoked).toEqual(['blob:0'])
    expect(cache.totalBytes()).toBe(70)
  })

  it('keeps evicting until under budget', () => {
    const revoked: string[] = []
    const cache = createPageLruCache(
      { maxBytes: 100 },
      (url: string) => revoked.push(url),
    )

    cache.set(0, 'blob:0', 10)
    cache.set(1, 'blob:1', 10)
    cache.set(2, 'blob:2', 10)
    // A huge new page forces multiple evictions but is never evicted itself,
    // even though it alone exceeds the budget.
    cache.set(3, 'blob:3', 500)
    expect(cache.keys()).toEqual([3])
    expect(revoked).toEqual(['blob:0', 'blob:1', 'blob:2'])
    expect(cache.totalBytes()).toBe(500)
  })

  it('get() refreshes recency and protects recent pages from eviction', () => {
    const revoked: string[] = []
    const cache = createPageLruCache(
      { maxBytes: 100 },
      (url: string) => revoked.push(url),
    )

    cache.set(0, 'blob:0', 40)
    cache.set(1, 'blob:1', 40)
    // Touching page 0 moves it behind page 1 in eviction order.
    expect(cache.get(0)).toBe('blob:0')

    cache.set(2, 'blob:2', 40)
    // Without the refresh page 0 would have been evicted; instead page 1 goes.
    expect(cache.keys()).toEqual([0, 2])
    expect(revoked).toEqual(['blob:1'])
    expect(cache.totalBytes()).toBe(80)

    // Re-setting an existing page replaces its recorded size and revokes
    // the old URL.
    cache.set(0, 'blob:0b', 50)
    expect(revoked).toEqual(['blob:1', 'blob:0'])
    expect(cache.totalBytes()).toBe(90)
  })

  it('falls back to estimateBytes when set has no explicit size', () => {
    const revoked: string[] = []
    const cache = createPageLruCache(
      { maxBytes: 100 },
      (url: string) => revoked.push(url),
      (url: string) => url.length,
    )

    cache.set(0, 'blob:0') // estimateBytes → 6
    cache.set(1, 'blob:1')
    expect(cache.totalBytes()).toBe(12)

    cache.set(2, 'blob:longer-url') // estimateBytes → 15; total 27 < 100
    expect(cache.totalBytes()).toBe(27)
    expect(cache.keys()).toEqual([0, 1, 2])
  })

  it('clear() resets totalBytes and revokes every URL', () => {
    const revoked: string[] = []
    const cache = createPageLruCache(
      { maxBytes: 100 },
      (url: string) => revoked.push(url),
    )

    cache.set(0, 'blob:0', 40)
    cache.set(1, 'blob:1', 40)
    cache.clear()
    expect(cache.totalBytes()).toBe(0)
    expect(cache.keys()).toEqual([])
    expect(revoked).toEqual(['blob:0', 'blob:1'])

    // Cache is usable after clear().
    cache.set(2, 'blob:2', 40)
    expect(cache.keys()).toEqual([2])
    expect(cache.totalBytes()).toBe(40)
  })

  it('count mode still behaves exactly as before', () => {
    const revoked: string[] = []
    const cache = createPageLruCache(2, (url: string) => revoked.push(url))

    for (let page = 0; page < 4; page += 1) {
      cache.set(page, `blob:${page}`)
    }
    expect(cache.keys()).toEqual([2, 3])
    expect(revoked).toEqual(['blob:0', 'blob:1'])
    expect(cache.get(2)).toBe('blob:2')

    cache.set(4, 'blob:4')
    expect(cache.keys()).toEqual([2, 4])
    expect(revoked).toEqual(['blob:0', 'blob:1', 'blob:3'])
  })
})

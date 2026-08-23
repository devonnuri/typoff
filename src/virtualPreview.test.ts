import { describe, expect, it } from 'vitest'
import {
  cropSvgToPage,
  createDocumentRequestGate,
  createPageLruCache,
  isolateSvgPage,
  normalizePageOffsets,
  stripSvgForeignObjects,
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

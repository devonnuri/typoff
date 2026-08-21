import { describe, expect, it } from 'vitest'
import { createSvgPreviewResources } from './previewResource'

describe('SVG preview resource lifecycle', () => {
  it('revokes the previous object URL on replace and the current URL on clear', () => {
    const revoked: string[] = []
    let id = 0
    const resources = createSvgPreviewResources({
      create(svg: string) {
        id += 1
        return `blob:${id}:${svg.length}`
      },
      revoke(url: string) {
        revoked.push(url)
      },
    })

    expect(resources.replace('<svg>one</svg>')).toBe('blob:1:14')
    expect(resources.replace('<svg>two</svg>')).toBe('blob:2:14')
    expect(revoked).toEqual(['blob:1:14'])

    resources.clear()
    expect(revoked).toEqual(['blob:1:14', 'blob:2:14'])
  })
})

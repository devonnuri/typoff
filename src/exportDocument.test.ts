import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./typst', () => ({
  exportTypstPages: vi.fn(),
}))

import {
  buildSvgPagesHtml,
  downloadSvgPages,
  exportCurrentDocument,
} from './exportDocument'
import { exportTypstPages } from './typst'

const exportTypstPagesMock = vi.mocked(exportTypstPages)

type MockAnchor = {
  href: string
  download: string
  click: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

const createdBlobs: Blob[] = []

const installDomMocks = () => {
  const anchors: MockAnchor[] = []
  const createElement = vi.fn(() => {
    const anchor: MockAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    }
    anchors.push(anchor)
    return anchor
  })
  const appendChild = vi.fn()
  const createObjectURL = vi.fn((blob: Blob) => {
    createdBlobs.push(blob)
    return `blob:mock-${createdBlobs.length}`
  })
  const revokeObjectURL = vi.fn()

  vi.stubGlobal('document', { createElement, body: { appendChild } })
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

  return { anchors, createElement, appendChild, createObjectURL, revokeObjectURL }
}

const lastBlobText = async () => {
  const blob = createdBlobs[createdBlobs.length - 1]
  return blob.text()
}

beforeEach(() => {
  createdBlobs.length = 0
  exportTypstPagesMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildSvgPagesHtml', () => {
  it('embeds every page svg in document order with separators', () => {
    const html = buildSvgPagesHtml(
      [
        { pageIndex: 1, svg: '<svg id="two" />' },
        { pageIndex: 0, svg: '<svg id="one" />' },
      ],
      'Report',
    )

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('data-page="1"')
    expect(html).toContain('data-page="2"')
    expect(html.indexOf('<svg id="one" />')).toBeLessThan(
      html.indexOf('<svg id="two" />'),
    )
    expect(html).toContain('typoff-page-separator')
  })
})

describe('downloadSvgPages', () => {
  it('downloads a single .svg file for one-page documents', () => {
    const dom = installDomMocks()

    downloadSvgPages([{ pageIndex: 0, svg: '<svg id="only" />' }], 'Report')

    expect(dom.createElement).toHaveBeenCalledWith('a')
    expect(dom.anchors).toHaveLength(1)
    const anchor = dom.anchors[0]
    expect(anchor.download).toBe('Report.svg')
    expect(anchor.href).toBe('blob:mock-1')
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(dom.appendChild).toHaveBeenCalledWith(anchor)
    expect(dom.createObjectURL).toHaveBeenCalledOnce()
  })

  it('downloads one .html archive containing all pages for multi-page documents', async () => {
    const dom = installDomMocks()

    downloadSvgPages(
      [
        { pageIndex: 1, svg: '<svg id="two" />' },
        { pageIndex: 0, svg: '<svg id="one" />' },
      ],
      'Report',
    )

    expect(dom.anchors).toHaveLength(1)
    const anchor = dom.anchors[0]
    expect(anchor.download).toBe('Report.html')
    expect(anchor.click).toHaveBeenCalledOnce()

    const html = await lastBlobText()
    expect(html).toContain('<svg id="one" />')
    expect(html).toContain('<svg id="two" />')
    expect(html).toContain('data-page="1"')
    expect(html).toContain('data-page="2"')
    // The object URL is released on a follow-up tick, matching fileIo.ts.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dom.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
  })

  it('throws when there are no pages to export', () => {
    installDomMocks()

    expect(() => downloadSvgPages([], 'Report')).toThrow(
      /no rendered pages/i,
    )
  })
})

describe('exportCurrentDocument', () => {
  it('renders every page via the worker and downloads the result', async () => {
    exportTypstPagesMock.mockResolvedValue([
      { pageIndex: 0, svg: '<svg id="one" />' },
      { pageIndex: 1, svg: '<svg id="two" />' },
    ])
    const dom = installDomMocks()

    await exportCurrentDocument('doc-7', 'Thesis')

    expect(exportTypstPagesMock).toHaveBeenCalledWith('doc-7')
    expect(dom.anchors[0]?.download).toBe('Thesis.html')
  })
})

export type TypstPageInfo = {
  pageOffset: number
  width: number
  height: number
}

export function createDocumentRequestGate() {
  let epoch = 0
  return {
    capture: () => epoch,
    startCompile: () => ++epoch,
    isCurrent: (candidate: number) => candidate === epoch,
  }
}

export function normalizePageOffsets(pages: TypstPageInfo[]): TypstPageInfo[] {
  let offset = 0
  return pages.map((page) => {
    const normalized = { ...page, pageOffset: offset }
    offset += page.height
    return normalized
  })
}

function setRootAttribute(root: string, name: string, value: string): string {
  const pattern = new RegExp(`\\s${name}="[^"]*"`)
  if (pattern.test(root)) {
    return root.replace(pattern, ` ${name}="${value}"`)
  }
  return root.replace(/>$/, ` ${name}="${value}">`)
}

export function cropSvgToPage(svg: string, page: TypstPageInfo): string {
  const rootEnd = svg.indexOf('>')
  if (rootEnd < 0 || !svg.startsWith('<svg')) {
    throw new Error('Typst renderer returned invalid SVG')
  }

  let root = svg.slice(0, rootEnd + 1)
  root = setRootAttribute(root, 'viewBox', `0 ${page.pageOffset} ${page.width} ${page.height}`)
  root = setRootAttribute(root, 'width', String(page.width))
  root = setRootAttribute(root, 'height', String(page.height))
  root = setRootAttribute(root, 'data-width', String(page.width))
  root = setRootAttribute(root, 'data-height', String(page.height))
  return root + svg.slice(rootEnd + 1)
}

function findElementEnd(svg: string, start: number, tagName: string): number {
  const tags = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'g')
  tags.lastIndex = start
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = tags.exec(svg))) {
    const tag = match[0]
    if (tag.startsWith('</')) {
      depth -= 1
      if (depth === 0) {
        return tags.lastIndex
      }
    } else if (!tag.endsWith('/>')) {
      depth += 1
    }
  }
  throw new Error(`Typst renderer returned an unclosed <${tagName}> element`)
}

export function stripSvgForeignObjects(svg: string): string {
  const foreignObjectStart = /<foreignObject\b[^>]*>/g
  let sanitized = svg
  let match: RegExpExecArray | null

  while ((match = foreignObjectStart.exec(sanitized))) {
    const start = match.index
    const opening = match[0]
    const end = opening.endsWith('/>')
      ? foreignObjectStart.lastIndex
      : findElementEnd(sanitized, start, 'foreignObject')

    sanitized = sanitized.slice(0, start) + sanitized.slice(end)
    foreignObjectStart.lastIndex = start
  }

  return sanitized
}

export function isolateSvgPage(
  svg: string,
  pageIndex: number,
  page: TypstPageInfo,
): string {
  const pagePattern = /<g\b(?=[^>]*class="[^"]*typst-page[^"]*")[^>]*>/g
  const pageStarts: number[] = []
  let match: RegExpExecArray | null
  while ((match = pagePattern.exec(svg))) {
    pageStarts.push(match.index)
  }

  const targetStart = pageStarts[pageIndex]
  const firstPageStart = pageStarts[0]
  if (targetStart === undefined || firstPageStart === undefined) {
    throw new Error(`Typst renderer did not return page ${pageIndex + 1}`)
  }

  const targetEnd = findElementEnd(svg, targetStart, 'g')
  const openingEnd = svg.indexOf('>', targetStart)
  if (openingEnd < 0 || openingEnd >= targetEnd) {
    throw new Error('Typst renderer returned an invalid page element')
  }

  const opening = setRootAttribute(
    svg.slice(targetStart, openingEnd + 1),
    'transform',
    'translate(0, 0)',
  )
  const targetPage = opening + svg.slice(openingEnd + 1, targetEnd)
  const isolated = `${svg.slice(0, firstPageStart)}${targetPage}</svg>`
  return cropSvgToPage(isolated, {
    ...page,
    pageOffset: 0,
  })
}

/**
 * Converts a click's viewport Y coordinate into document points relative to
 * the top of the rendered page element.
 */
export function computeClickedYPt(
  clientY: number,
  rectTop: number,
  zoom: number,
): number {
  return (clientY - rectTop) / zoom
}

export type PageLruCapacity = number | { maxBytes: number }

/**
 * LRU cache for rendered page blob URLs.
 *
 * - Count mode: `capacity` is a plain number — at most that many pages are
 *   kept (legacy behavior).
 * - Byte mode: `capacity` is `{ maxBytes }` and each entry records its size
 *   via `set(page, url, byteSize)` (or `estimateBytes(url)`); the oldest
 *   entry is revoked whenever total recorded bytes exceed `maxBytes`.
 */
export function createPageLruCache(
  capacity: PageLruCapacity,
  revoke: (url: string) => void,
  estimateBytes?: (url: string) => number,
) {
  const entries = new Map<number, string>()
  const byteSizes = new Map<number, number>()
  const maxBytes = typeof capacity === 'number' ? Infinity : capacity.maxBytes

  const resolveBytes = (page: number, url: string, byteSize?: number) => {
    const recorded = byteSizes.get(page)
    return byteSize ?? (recorded ?? (estimateBytes ? estimateBytes(url) : 0))
  }

  let total = 0

  return {
    get(page: number) {
      const value = entries.get(page)
      if (!value) {
        return undefined
      }
      entries.delete(page)
      entries.set(page, value)
      return value
    },
    set(page: number, url: string, byteSize?: number) {
      const previous = entries.get(page)
      if (previous) {
        revoke(previous)
        total -= byteSizes.get(page) ?? 0
        byteSizes.delete(page)
        entries.delete(page)
      }
      entries.set(page, url)
      const resolved = resolveBytes(page, url, byteSize)
      byteSizes.set(page, resolved)
      total += resolved
      // In byte mode, always keep at least one entry even when it alone
      // exceeds the budget.
      while (
        (typeof capacity === 'number' && entries.size > capacity) ||
        (total > maxBytes && entries.size > 1)
      ) {
        const oldest = entries.entries().next().value as [number, string] | undefined
        if (!oldest) {
          break
        }
        entries.delete(oldest[0])
        total -= byteSizes.get(oldest[0]) ?? 0
        byteSizes.delete(oldest[0])
        revoke(oldest[1])
      }
    },
    keys() {
      return [...entries.keys()]
    },
    totalBytes() {
      return total
    },
    clear() {
      for (const url of entries.values()) {
        revoke(url)
      }
      entries.clear()
      byteSizes.clear()
      total = 0
    },
  }
}

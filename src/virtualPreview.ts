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

export function createPageLruCache(
  capacity: number,
  revoke: (url: string) => void,
) {
  const entries = new Map<number, string>()

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
    set(page: number, url: string) {
      const previous = entries.get(page)
      if (previous) {
        revoke(previous)
        entries.delete(page)
      }
      entries.set(page, url)
      while (entries.size > capacity) {
        const oldest = entries.entries().next().value as [number, string] | undefined
        if (!oldest) {
          break
        }
        entries.delete(oldest[0])
        revoke(oldest[1])
      }
    },
    keys() {
      return [...entries.keys()]
    },
    clear() {
      for (const url of entries.values()) {
        revoke(url)
      }
      entries.clear()
    },
  }
}

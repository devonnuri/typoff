type SvgResourceAdapter = {
  create(svg: string): string
  revoke(url: string): void
}

export function createSvgPreviewResources(adapter: SvgResourceAdapter) {
  let currentUrl: string | null = null

  return {
    replace(svg: string) {
      const nextUrl = adapter.create(svg)
      if (currentUrl) {
        adapter.revoke(currentUrl)
      }
      currentUrl = nextUrl
      return nextUrl
    },
    clear() {
      if (currentUrl) {
        adapter.revoke(currentUrl)
        currentUrl = null
      }
    },
  }
}

export function createBrowserSvgPreviewResources() {
  return createSvgPreviewResources({
    create(svg) {
      return URL.createObjectURL(
        new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      )
    },
    revoke(url) {
      URL.revokeObjectURL(url)
    },
  })
}

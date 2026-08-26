import { useCallback, useEffect, useRef, useState } from 'react'
import { renderTypstPage } from './typst'
import {
  computeClickedYPt,
  createPageLruCache,
  type TypstPageInfo,
} from './virtualPreview'

type VirtualPreviewProps = {
  documentId: string
  pages: TypstPageInfo[]
  zoom: number
  scrollTarget?: { pageIndex: number; nonce: number } | null
  /** Invoked when a rendered page is clicked with its index and Y in points. */
  onPageClick?: (pageIndex: number, yPt: number) => void
}

function createSvgUrl(svg: string) {
  return URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
  )
}

// 24 MiB budget for cached page blob URLs.
const PAGE_CACHE_MAX_BYTES = 24 * 1024 * 1024

export function VirtualPreview({
  documentId,
  pages,
  zoom,
  scrollTarget,
  onPageClick,
}: VirtualPreviewProps) {
  const [urls, setUrls] = useState<Map<number, string>>(() => new Map())
  const [errors, setErrors] = useState<Map<number, string>>(() => new Map())
  const elementsRef = useRef(new Map<number, HTMLElement>())
  const inFlightRef = useRef(new Set<number>())
  const documentIdRef = useRef(documentId)
  const mountedRef = useRef(true)
  const handledScrollNonceRef = useRef<number | null>(null)
  // Byte-budgeted LRU: Typst SVGs vary wildly in size per page, so cap total
  // bytes instead of page count. Blob URLs carry no size metadata, so we
  // record `result.svg.length` at set() time — char count approximates bytes
  // for ASCII-heavy SVG output (non-ASCII chars count as 1 instead of 2-4).
  const cacheRef = useRef(
    createPageLruCache({ maxBytes: PAGE_CACHE_MAX_BYTES }, (url) =>
      URL.revokeObjectURL(url),
    ),
  )

  useEffect(() => {
    documentIdRef.current = documentId
    // New document: the old pages stay on screen (double buffering) but must
    // not be served from cache again — detach cached URLs without revoking
    // them so displayed <img> nodes survive until fresh renders replace src.
    cacheRef.current.detach()
    inFlightRef.current.clear()
  }, [documentId])

  useEffect(() => {
    const cache = cacheRef.current
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cache.clear()
    }
  }, [])

  const loadPage = useCallback(
    async (pageIndex: number) => {
      if (pageIndex < 0 || pageIndex >= pages.length) {
        return
      }
      const cached = cacheRef.current.get(pageIndex)
      if (cached || inFlightRef.current.has(pageIndex)) {
        return
      }

      inFlightRef.current.add(pageIndex)
      try {
        const result = await renderTypstPage(documentId, pageIndex)
        if (!mountedRef.current || documentIdRef.current !== result.documentId) {
          return
        }
        const url = createSvgUrl(result.svg)
        // The displayed URL may survive a cache detach (double buffering);
        // revoke it only now that its fresh replacement is taking over.
        cacheRef.current.set(pageIndex, url, result.svg.length)
        setUrls((current) => {
          const staleUrl = current.get(pageIndex)
          if (staleUrl && staleUrl !== url) {
            URL.revokeObjectURL(staleUrl)
          }
          const next = new Map(current)
          next.set(pageIndex, url)
          return next
        })
        setErrors((current) => {
          if (!current.has(pageIndex)) {
            return current
          }
          const next = new Map(current)
          next.delete(pageIndex)
          return next
        })
      } catch (error) {
        if (mountedRef.current && documentIdRef.current === documentId) {
          setErrors((current) =>
            new Map(current).set(
              pageIndex,
              error instanceof Error ? error.message : 'Page preview failed',
            ),
          )
        }
      } finally {
        inFlightRef.current.delete(pageIndex)
      }
    },
    [documentId, pages.length],
  )

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue
          }
          const pageIndex = Number(
            (entry.target as HTMLElement).dataset.pageIndex,
          )
          void loadPage(pageIndex - 1)
          void loadPage(pageIndex)
          void loadPage(pageIndex + 1)
        }
      },
      { root: null, rootMargin: '100% 0px' },
    )

    for (const element of elementsRef.current.values()) {
      observer.observe(element)
    }
    return () => observer.disconnect()
  }, [loadPage, pages.length])

  useEffect(() => {
    if (
      !scrollTarget ||
      handledScrollNonceRef.current === scrollTarget.nonce
    ) {
      return
    }
    const page = elementsRef.current.get(scrollTarget.pageIndex)
    const scroller = page?.closest<HTMLElement>('.preview-body')
    if (!page || !scroller) {
      return
    }
    handledScrollNonceRef.current = scrollTarget.nonce
    void loadPage(scrollTarget.pageIndex)
    const pageRect = page.getBoundingClientRect()
    const scrollerRect = scroller.getBoundingClientRect()
    scroller.scrollTo({
      top: scroller.scrollTop + pageRect.top - scrollerRect.top,
      behavior: 'smooth',
    })
  }, [loadPage, scrollTarget])

  return (
    <div
      className="virtual-preview"
      aria-label={`${pages.length} page${pages.length === 1 ? '' : 's'} document`}
    >
      {pages.map((page, pageIndex) => (
        <article
          className="virtual-page"
          data-page-index={pageIndex}
          key={pageIndex}
          ref={(element) => {
            if (element) {
              elementsRef.current.set(pageIndex, element)
            } else {
              elementsRef.current.delete(pageIndex)
            }
          }}
          style={{
            width: `${page.width * zoom}px`,
            height: `${page.height * zoom}px`,
          }}
          aria-label={`Page ${pageIndex + 1}`}
          onClick={
            onPageClick && urls.get(pageIndex)
              ? (event) => {
                  // Ignore text-selection drags so highlighting content in
                  // the preview does not yank the editor cursor around.
                  if (window.getSelection()?.toString()) {
                    return
                  }
                  const rect = event.currentTarget.getBoundingClientRect()
                  onPageClick(
                    pageIndex,
                    computeClickedYPt(event.clientY, rect.top, zoom),
                  )
                }
              : undefined
          }
        >
          {urls.get(pageIndex) ? (
            <img
              className="preview-surface"
              src={urls.get(pageIndex)}
              alt={`Preview page ${pageIndex + 1}`}
            />
          ) : errors.get(pageIndex) ? (
            <button
              className="page-preview-error"
              type="button"
              onClick={() => void loadPage(pageIndex)}
            >
              {errors.get(pageIndex)} — retry
            </button>
          ) : (
            <span className="page-placeholder">Page {pageIndex + 1}</span>
          )}
        </article>
      ))}
    </div>
  )
}

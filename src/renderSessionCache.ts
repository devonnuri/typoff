import type { RenderSession } from '@myriaddreamin/typst.ts'
import {
  isolateSvgPage,
  stripSvgForeignObjects,
  type TypstPageInfo,
} from './virtualPreview'

/** Minimal slice of the Typst renderer used to keep a session warm. */
export interface TypstRendererSessionApi {
  createModule(artifact: Uint8Array): Promise<RenderSession>
  manipulateData(options: {
    renderSession: RenderSession
    action: 'reset' | 'merge'
    data?: Uint8Array
  }): void | Promise<void>
}

export interface SvgRenderWindow {
  lo: { x: number; y: number }
  hi: { x: number; y: number }
}

/** Minimal slice of the Typst renderer needed to rasterize one page. */
export interface TypstRendererLike extends TypstRendererSessionApi {
  renderSvgDiff(options: {
    renderSession: RenderSession
    window?: SvgRenderWindow
  }): string
  runWithSession<T>(fn: (session: RenderSession) => Promise<T>): Promise<T>
}

export interface OpenRenderSession {
  documentId: string
  session: RenderSession
}

export function shouldReuseSession(
  openSession: Pick<OpenRenderSession, 'documentId'> | undefined,
  documentId: string,
): boolean {
  return openSession !== undefined && openSession.documentId === documentId
}

/**
 * Keeps at most one long-lived renderer session alive so page renders of the
 * same document skip artifact re-injection entirely.
 */
export class RenderSessionCache {
  private entry: OpenRenderSession | undefined

  /** Session for `documentId`, or undefined when it is not cached. */
  get(documentId: string): RenderSession | undefined {
    if (!shouldReuseSession(this.entry, documentId)) {
      return undefined
    }
    return this.entry?.session
  }

  /**
   * Returns a session holding `artifact` under `documentId`.
   *
   * Reuses the cached session slot by resetting its content when possible
   * (cheap) and only creates a fresh module when there is no usable slot.
   */
  async acquire(
    renderer: TypstRendererSessionApi,
    documentId: string,
    artifact: Uint8Array,
  ): Promise<RenderSession> {
    const existing = this.entry?.session
    if (existing) {
      try {
        await renderer.manipulateData({
          renderSession: existing,
          action: 'reset',
          data: artifact,
        })
        this.entry = { documentId, session: existing }
        return existing
      } catch {
        // Fall through: a poisoned session slot is replaced below.
      }
    }
    const session = await renderer.createModule(artifact)
    this.entry = { documentId, session }
    return session
  }

  invalidate(): void {
    this.entry = undefined
  }
}

function finalizePageSvg(
  rendered: string,
  pageIndex: number,
  page: TypstPageInfo,
): string {
  const sanitized = stripSvgForeignObjects(rendered)
  return isolateSvgPage(sanitized, pageIndex, page)
}

function pageRenderWindow(page: TypstPageInfo): SvgRenderWindow {
  return {
    lo: { x: 0, y: page.pageOffset },
    hi: { x: page.width, y: page.pageOffset + page.height - 0.001 },
  }
}

/**
 * Renders one page of an already-compiled document.
 *
 * The renderer's `render_svg_diff` is stateful: once a windowed diff is
 * produced, later calls on the same session can come back empty until the
 * artifact is re-injected. So every page render starts by resetting the
 * session's data to the artifact (`action: 'reset'`, cheap on a warm slot),
 * then renders. If that fails on a cached session, the cache is invalidated
 * and the page is rebuilt once in a throwaway session.
 */
export async function renderDocumentPage(
  renderer: TypstRendererLike,
  cache: RenderSessionCache,
  documentId: string,
  artifact: Uint8Array,
  pageIndex: number,
  page: TypstPageInfo,
): Promise<string> {
  const renderWindow = pageRenderWindow(page)
  const cachedSession = cache.get(documentId)
  if (cachedSession) {
    try {
      await renderer.manipulateData({
        renderSession: cachedSession,
        action: 'reset',
        data: artifact,
      })
      return finalizePageSvg(
        renderer.renderSvgDiff({ renderSession: cachedSession, window: renderWindow }),
        pageIndex,
        page,
      )
    } catch {
      cache.invalidate()
    }
  }
  return renderer.runWithSession(async (session) => {
    await renderer.manipulateData({
      renderSession: session,
      action: 'reset',
      data: artifact,
    })
    const rendered = renderer.renderSvgDiff({ renderSession: session, window: renderWindow })
    return finalizePageSvg(rendered, pageIndex, page)
  })
}

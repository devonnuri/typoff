import { VirtualPreview } from '../VirtualPreview'
import { Button } from './ui/button'
import type {
  PreviewDocument,
  PreviewState,
} from '../hooks/usePreviewPipeline'

interface PreviewPaneProps {
  compact?: boolean
  hidden?: boolean
  previewLabel: string
  onRenderOnce: () => void
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  previewState: PreviewState
  previewError: string | null
  /**
   * Message explaining why the currently shown (buffered) pages are stale,
   * shown as a thin strip while the previous render stays visible.
   */
  lastPreviewError?: string | null
  previewDocument: PreviewDocument | null
  /** Scroll target for VirtualPreview: `{ pageIndex, nonce }` or null. */
  previewScrollTarget: { pageIndex: number; nonce: number } | null
  /** Invoked when a rendered preview page is clicked: `(pageIndex, yPt)`. */
  onPageClick?: (pageIndex: number, yPt: number) => void
}

export function PreviewPane({
  compact = false,
  hidden = false,
  previewLabel,
  onRenderOnce,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  previewState,
  previewError,
  lastPreviewError,
  previewDocument,
  previewScrollTarget,
  onPageClick,
}: PreviewPaneProps) {
  return (
    <section className="preview-pane" id="preview-panel" hidden={hidden} role={compact ? 'tabpanel' : undefined} aria-labelledby={compact ? 'preview-tab' : 'preview-heading'}>
      <div className="pane-header">
        <div className="pane-title">
          <h2 id="preview-heading">Preview</h2>
          <span role="status">{previewLabel}</span>
        </div>
        <div className="pane-actions">
          <Button variant="secondary" size="sm" type="button" onClick={onRenderOnce}>
            Render
          </Button>
          <Button variant="ghost" size="icon-sm"
            type="button"
            onClick={onZoomOut}
            disabled={zoom <= 0.5}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="square"
              />
            </svg>
          </Button>
          <Button variant="ghost" size="sm"
            type="button"
            onClick={onZoomReset}
          >
            {Math.round(zoom * 100)}%
          </Button>
          <Button variant="ghost" size="icon-sm"
            type="button"
            onClick={onZoomIn}
            disabled={zoom >= 2}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="square"
              />
            </svg>
          </Button>
        </div>
      </div>
      <div className="pane-body preview-body">
        {lastPreviewError && previewDocument ? (
          <div className="preview-stale-strip" role="status">
            Showing the last successful render — {lastPreviewError}
          </div>
        ) : null}
        {previewState === 'error' && !previewDocument ? (
          <div className="preview-error">
            <p>{previewError ? 'Preview failed' : 'Typst found a problem'}</p>
            {previewError ? (
              <pre>{previewError}</pre>
            ) : (
              <span>See the highlighted source and Problems pane.</span>
            )}
            <Button variant="outline" type="button" onClick={onRenderOnce}>
              Retry render
            </Button>
          </div>
        ) : previewDocument ? (
          <VirtualPreview
            documentId={previewDocument.id}
            pages={previewDocument.pages}
            zoom={zoom}
            scrollTarget={previewScrollTarget}
            onPageClick={onPageClick}
          />
        ) : (
          <div className="empty-state">
            {previewState === 'rendering' ? (
              <div role="status">
                <p>Preparing the Typst preview…</p>
                <p>The first render loads the compiler and fonts. You can keep editing; after offline assets finish caching, they work without a connection.</p>
              </div>
            ) : <p>Your Typst preview will appear here.</p>}
          </div>
        )}
      </div>
    </section>
  )
}

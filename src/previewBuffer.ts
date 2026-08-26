import type { PreviewDocument } from './hooks/usePreviewPipeline'

/**
 * Double-buffer state for the preview pane: the last successfully rendered
 * document stays visible while a new compile runs, and is only replaced once
 * the new document arrives. Compile failures keep the previous buffer.
 */
export interface PreviewBufferState {
  rendered: PreviewDocument | null
  pending: boolean
}

export type PreviewBufferEvent =
  | { type: 'compile-start' }
  | {
      type: 'compile-success'
      document: PreviewDocument
      /** Version of the finished compile, when stale-result checks apply. */
      renderVersion?: number
      currentRenderVersion?: number
    }
  | { type: 'compile-error'; message: string }
  /** The user switched files: the old pages no longer belong on screen. */
  | { type: 'source-switch' }

export function applyDoubleBufferUpdate(
  state: PreviewBufferState,
  event: PreviewBufferEvent,
): PreviewBufferState {
  switch (event.type) {
    case 'compile-start':
      return { rendered: state.rendered, pending: true }
    case 'compile-success': {
      if (
        event.renderVersion !== undefined &&
        event.currentRenderVersion !== undefined &&
        event.renderVersion !== event.currentRenderVersion
      ) {
        return state
      }
      return { rendered: event.document, pending: false }
    }
    case 'compile-error':
      return { rendered: state.rendered, pending: false }
    case 'source-switch':
      return { rendered: null, pending: false }
  }
}

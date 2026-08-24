import { useEffect, useRef, useState } from 'react'
import { exportCurrentDocument } from '../exportDocument'
import {
  getPreviewPolicy,
  recordCompileDuration,
} from '../previewPolicy'
import {
  createRenderVersionGate,
  synchronizeRenderTransition,
} from '../renderVersion'
import { CursorLookupThrottle } from '../cursorLookup'
import {
  compileTypstWorkspace,
  disposeTypstWorker,
  locateSourceOffset,
  locateTypstCursor,
  retryAfterFatalError,
} from '../typst'
import {
  buildTypstWorkspace,
  type TypstDiagnostic,
} from '../typstWorkspace'
import type { TypstPageInfo } from '../virtualPreview'
import type { StoredFile } from '../storage'

export type PreviewState = 'idle' | 'rendering' | 'error'
export type ExportState = 'idle' | 'exporting'

export interface PreviewDocument {
  id: string
  pages: TypstPageInfo[]
}

interface UsePreviewPipelineOptions {
  activeFile: StoredFile | null
  activeFileId: string | null
  activeContent: string
  latestContentRef: React.RefObject<string>
  latestFilesRef: React.RefObject<StoredFile[]>
  latestActiveFileIdRef: React.RefObject<string | null>
}

export function usePreviewPipeline({
  activeFile,
  activeFileId,
  activeContent,
  latestContentRef,
  latestFilesRef,
  latestActiveFileIdRef,
}: UsePreviewPipelineOptions) {
  const [previewDocument, setPreviewDocument] = useState<PreviewDocument | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>('idle')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<TypstDiagnostic[]>([])
  const [exportState, setExportState] = useState<ExportState>('idle')
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const [previewScrollTarget, setPreviewScrollTarget] = useState<{
    pageIndex: number
    nonce: number
  } | null>(null)
  const [cursorTarget, setCursorTarget] = useState<{
    offset: number
    nonce: number
  } | null>(null)

  const renderVersionRef = useRef(createRenderVersionGate())
  const renderTimerRef = useRef<number | null>(null)
  const renderInProgressRef = useRef(false)
  const pendingRenderRef = useRef(false)
  const renderRetryCountRef = useRef(0)
  const cursorLookupRef = useRef(0)
  const cursorThrottleRef = useRef<CursorLookupThrottle | null>(null)
  if (cursorThrottleRef.current === null) {
    cursorThrottleRef.current = new CursorLookupThrottle()
  }

  useEffect(() => {
    return () => disposeTypstWorker()
  }, [])

  const queueRender = (immediate: boolean) => {
    latestContentRef.current = activeContent

    if (renderTimerRef.current) {
      window.clearTimeout(renderTimerRef.current)
      renderTimerRef.current = null
    }

    if (!activeContent || !activeFileId) {
      setPreviewDocument(null)
      setPreviewState('idle')
      setPreviewError(null)
      setDiagnostics([])
      return
    }

    const scheduleRender = () => {
      const run = async () => {
        if (renderInProgressRef.current) {
          pendingRenderRef.current = true
          return
        }

        renderInProgressRef.current = true
        pendingRenderRef.current = false
        setPreviewState('rendering')
        const renderVersion = renderVersionRef.current.begin()
        const content = latestContentRef.current
        const currentActiveFileId = latestActiveFileIdRef.current

        try {
          if (!currentActiveFileId || !content) {
            setPreviewDocument(null)
            setPreviewState('idle')
            return
          }
          const workspace = buildTypstWorkspace(
            latestFilesRef.current,
            currentActiveFileId,
            content,
          )
          const compileStartedAt = performance.now()
          const result = await compileTypstWorkspace(workspace)
          if (!renderVersionRef.current.isCurrent(renderVersion)) {
            return
          }

          recordCompileDuration(performance.now() - compileStartedAt)

          renderRetryCountRef.current = 0
          setDiagnostics(result.diagnostics)
          setPreviewError(null)
          if (result.documentId && result.pages.length > 0) {
            setPreviewDocument({ id: result.documentId, pages: result.pages })
            setPreviewState('idle')
          } else {
            setPreviewState('error')
          }
        } catch (error) {
          if (!renderVersionRef.current.isCurrent(renderVersion)) {
            return
          }
          // A dead worker rejects every request; retry once on a fresh worker.
          if (
            renderRetryCountRef.current < 1 &&
            typeof error === 'object' &&
            error !== null &&
            'message' in error &&
            String((error as Error).message).includes('worker')
          ) {
            renderRetryCountRef.current += 1
            retryAfterFatalError()
            scheduleRender()
            return
          }
          renderRetryCountRef.current = 0
          setDiagnostics([])
          setPreviewState('error')
          setPreviewError(
            error instanceof Error && error.message
              ? error.message
              : 'Typst preview failed unexpectedly',
          )
        } finally {
          renderInProgressRef.current = false
          if (pendingRenderRef.current) {
            pendingRenderRef.current = false
            scheduleRender()
          }
        }
      }

      void run()
    }

    if (immediate) {
      scheduleRender()
      return
    }

    const { delayMs } = getPreviewPolicy(activeContent.length)
    renderTimerRef.current = window.setTimeout(scheduleRender, delayMs)
  }

  useEffect(() => {
    queueRender(false)

    return () => {
      if (renderTimerRef.current) {
        window.clearTimeout(renderTimerRef.current)
      }
    }
    // queueRender closes over activeContent/activeFileId, which are already
    // listed; the function identity changes every render by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContent, activeFileId, workspaceRevision])

  // Called when the editor switches to a different source wholesale (opening
  // a file, or deleting the last file): resets scroll state and settles the
  // preview back to idle.
  const beginSourceSwitch = (source: string) => {
    cursorLookupRef.current += 1
    setPreviewScrollTarget(null)
    synchronizeRenderTransition({
      gate: renderVersionRef.current,
      source,
      latestSource: latestContentRef,
      pending: pendingRenderRef,
      timer: renderTimerRef,
      clearTimer: window.clearTimeout,
      settlePreview: () => {
        setPreviewDocument(null)
        setDiagnostics([])
        setPreviewState('idle')
        setPreviewError(null)
      },
    })
  }

  // Called on every keystroke: keeps the render transition in sync without
  // clearing the current preview document.
  const notifySourceEdit = (value: string) => {
    cursorLookupRef.current += 1
    synchronizeRenderTransition({
      gate: renderVersionRef.current,
      source: value,
      latestSource: latestContentRef,
      pending: pendingRenderRef,
      timer: renderTimerRef,
      clearTimer: window.clearTimeout,
      settlePreview: () => {
        setDiagnostics([])
        setPreviewState(
          value
            ? 'rendering'
            : 'idle',
        )
        setPreviewError(null)
      },
    })
  }

  const bumpWorkspaceRevision = () => {
    setWorkspaceRevision((revision) => revision + 1)
  }

  const reportInvalidPath = (message: string) => {
    setPreviewState('error')
    setPreviewError(message)
  }

  const handleCursorClick = async (offset: number) => {
    const currentActiveFileId = latestActiveFileIdRef.current
    const content = latestContentRef.current
    if (!currentActiveFileId || !content || !previewDocument) {
      return
    }
    const cursorThrottle = cursorThrottleRef.current
    if (!cursorThrottle) {
      return
    }
    const cacheKey = `${content.length}:${offset}`
    const cachedPageIndex = cursorThrottle.cached(cacheKey)
    if (cachedPageIndex !== undefined) {
      if (
        cachedPageIndex < 0 ||
        cachedPageIndex >= previewDocument.pages.length
      ) {
        return
      }
      const cachedRequestId = ++cursorLookupRef.current
      setPreviewScrollTarget({
        pageIndex: cachedPageIndex,
        nonce: cachedRequestId,
      })
      return
    }
    if (!cursorThrottle.request(cacheKey)) {
      return
    }
    const requestId = ++cursorLookupRef.current
    const workspace = buildTypstWorkspace(
      latestFilesRef.current,
      currentActiveFileId,
      content,
    )
    try {
      const result = await locateTypstCursor(workspace, offset)
      if (
        requestId !== cursorLookupRef.current ||
        currentActiveFileId !== latestActiveFileIdRef.current ||
        result.pageIndex < 0 ||
        result.pageIndex >= previewDocument.pages.length
      ) {
        return
      }
      cursorThrottle.remember(cacheKey, result.pageIndex)
      setPreviewScrollTarget({ pageIndex: result.pageIndex, nonce: requestId })
    } catch {
      // A marker cannot be inserted safely at every Typst code position.
      // Leave the current preview position unchanged when lookup fails.
    }
  }

  // Maps a click on a rendered preview page back to a source offset and
  // moves the editor cursor there. Errors are silently ignored: not every
  // rendered position has a mappable source location.
  const handleSourceJump = async (pageIndex: number, yPt: number) => {
    const currentActiveFileId = latestActiveFileIdRef.current
    const content = latestContentRef.current
    if (!currentActiveFileId || !content || previewState === 'rendering') {
      return
    }
    const requestId = ++cursorLookupRef.current
    try {
      const offset = await locateSourceOffset(
        buildTypstWorkspace(latestFilesRef.current, currentActiveFileId, content),
        pageIndex,
        yPt,
      )
      if (requestId !== cursorLookupRef.current) {
        return
      }
      setCursorTarget({ offset, nonce: requestId })
    } catch {
      // The clicked area has no mappable source position; leave the cursor.
    }
  }

  const handleExportSvg = async () => {
    if (!previewDocument) {
      return
    }
    setExportState('exporting')
    try {
      const baseName = activeFile
        ? activeFile.name.replace(/\.typ$/i, '')
        : 'document'
      await exportCurrentDocument(previewDocument.id, baseName)
    } finally {
      setExportState('idle')
    }
  }

  return {
    // state
    previewDocument,
    previewState,
    previewError,
    diagnostics,
    exportState,
    workspaceRevision,
    previewScrollTarget,
    cursorTarget,
    // actions
    queueRender,
    beginSourceSwitch,
    notifySourceEdit,
    bumpWorkspaceRevision,
    reportInvalidPath,
    handleCursorClick,
    handleSourceJump,
    handleExportSvg,
  }
}

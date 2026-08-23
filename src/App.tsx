import { useEffect, useRef, useState } from 'react'
import './App.css'
import { mapShortcutToAction, type AppShortcutAction } from './appShortcuts'
import { TypstEditor } from './TypstEditor'
import {
  MIN_PANE_WIDTH,
  MIN_SIDEBAR_WIDTH,
  applyKeyboardResize,
  isResizeArrowKey,
} from './resizeLogic'
import { FileSidebar } from './components/FileSidebar'
import { PreviewPane } from './components/PreviewPane'
import {
  useFileLibrary,
  type FileLibraryPipelineBridge,
} from './hooks/useFileLibrary'
import { usePreviewPipeline } from './hooks/usePreviewPipeline'

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [editorWidth, setEditorWidth] = useState(520)
  const [previewWidth, setPreviewWidth] = useState(520)
  const [zoom, setZoom] = useState(1)

  // Populated below, during render, once both hooks have produced their APIs.
  // Every consumer runs from effects/handlers, never during render.
  const pipelineBridgeRef = useRef<FileLibraryPipelineBridge | null>(null)

  const library = useFileLibrary({ pipelineBridge: pipelineBridgeRef })

  const pipeline = usePreviewPipeline({
    activeFile: library.activeFile,
    activeFileId: library.activeFileId,
    activeContent: library.activeContent,
    latestContentRef: library.latestContentRef,
    latestFilesRef: library.latestFilesRef,
    latestActiveFileIdRef: library.latestActiveFileIdRef,
  })
  const {
    previewDocument,
    previewState,
    previewError,
    diagnostics,
    exportState,
    autoPreview,
    setAutoPreview,
    previewScrollTarget,
    queueRender,
    handleCursorClick,
    handleExportSvg,
  } = pipeline

  // Wire the file-library bridge to the preview pipeline. Assigned every
  // render so closures stay fresh (same pattern as appShortcutRef below).
  pipelineBridgeRef.current = {
    beginSourceSwitch: pipeline.beginSourceSwitch,
    reportInvalidPath: pipeline.reportInvalidPath,
    bumpWorkspaceRevision: pipeline.bumpWorkspaceRevision,
  }

  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const appShortcutRef = useRef<(action: AppShortcutAction) => void>(() => {})

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) {
      return
    }

    const handleWidth = 8
    const total = workspace.clientWidth
    const sidebar = isSidebarOpen ? sidebarWidth : 0
    const handles = isSidebarOpen ? handleWidth * 2 : handleWidth
    const remaining = Math.max(total - sidebar - handles, 0)
    const nextEditor = Math.max(360, Math.floor(remaining * 0.55))
    const nextPreview = Math.max(360, remaining - nextEditor)

    setEditorWidth(nextEditor)
    setPreviewWidth(nextPreview)
    // Intentional: this effect re-balances panes on sidebar toggle only, and
    // must not re-fire while the user drags the sidebar (sidebarWidth changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSidebarOpen])

  const saveLabel =
    library.saveState === 'saving'
      ? 'Saving...'
      : library.saveState === 'dirty'
        ? 'Unsaved changes'
        : 'All changes saved'

  const handleEditorChange = (value: string) => {
    pipeline.notifySourceEdit(value)
    library.changeActiveContent(value)
  }

  const previewLabel =
    previewState === 'rendering'
      ? 'Rendering preview'
      : previewState === 'error'
        ? 'Preview error'
        : previewDocument
          ? `Preview ready (${previewDocument.pages.length} page${previewDocument.pages.length === 1 ? '' : 's'}, virtualized)`
          : 'Preview ready'

  const clampZoom = (value: number) => Math.min(2, Math.max(0.5, value))

  const handleZoomIn = () => setZoom((current) => clampZoom(current + 0.1))
  const handleZoomOut = () => setZoom((current) => clampZoom(current - 0.1))
  const handleZoomReset = () => setZoom(1)

  const handleRenderOnce = () => queueRender(true)

  // Global shortcuts: one window keydown listener for the app's lifetime.
  // The dispatcher is read through a ref so the listener never re-binds even
  // though the handlers it calls are recreated on each render.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = mapShortcutToAction(event)
      if (!action) {
        return
      }
      event.preventDefault()
      appShortcutRef.current(action)
    }

    window.addEventListener('keydown', onKeyDown, false)
    return () => window.removeEventListener('keydown', onKeyDown, false)
  }, [])

  appShortcutRef.current = (action: AppShortcutAction) => {
    switch (action) {
      case 'render':
        handleRenderOnce()
        break
      case 'new-file':
        void library.createFile()
        break
      case 'toggle-sidebar':
        setIsSidebarOpen((prev) => !prev)
        break
      case 'zoom-in':
        handleZoomIn()
        break
      case 'zoom-out':
        handleZoomOut()
        break
      case 'reset-zoom':
        handleZoomReset()
        break
    }
  }

  const startResize = (mode: 'sidebar' | 'editor', startX: number) => {
    const workspace = workspaceRef.current
    if (!workspace) {
      return
    }

    const handleWidth = 8
    const total = workspace.clientWidth
    const handles = isSidebarOpen ? handleWidth * 2 : handleWidth
    const initialSidebar = sidebarWidth
    const initialEditor = editorWidth
    const minSidebar = 180
    const minPane = 320

    const onMove = (event: MouseEvent) => {
      const delta = event.clientX - startX

      if (mode === 'sidebar') {
        const nextSidebar = Math.min(
          Math.max(initialSidebar + delta, minSidebar),
          total - handles - minPane * 2,
        )
        const remaining = total - nextSidebar - handles
        const maxEditor = remaining - minPane
        const nextEditor = Math.min(initialEditor, maxEditor)
        const nextPreview = remaining - nextEditor

        setSidebarWidth(nextSidebar)
        setEditorWidth(nextEditor)
        setPreviewWidth(nextPreview)
        return
      }

      const remaining = total - (isSidebarOpen ? sidebarWidth : 0) - handles
      const nextEditor = Math.min(
        Math.max(initialEditor + delta, minPane),
        remaining - minPane,
      )
      const nextPreview = remaining - nextEditor

      setEditorWidth(nextEditor)
      setPreviewWidth(nextPreview)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleResizeKeyDown =
    (mode: 'sidebar' | 'editor') =>
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const workspace = workspaceRef.current
      if (!workspace || !isResizeArrowKey(event.key)) {
        return
      }
      const key = event.key
      event.preventDefault()

      const handleWidth = 8
      const total = workspace.clientWidth
      const handles = isSidebarOpen ? handleWidth * 2 : handleWidth
      const minSidebar = MIN_SIDEBAR_WIDTH
      const minPane = MIN_PANE_WIDTH

      if (mode === 'sidebar') {
        const maxSidebar = Math.max(minSidebar, total - handles - minPane * 2)
        const nextSidebar = applyKeyboardResize(sidebarWidth, key, {
          min: minSidebar,
          max: maxSidebar,
        })
        const remaining = total - nextSidebar - handles
        const nextEditor = Math.min(editorWidth, remaining - minPane)

        setSidebarWidth(nextSidebar)
        setEditorWidth(nextEditor)
        setPreviewWidth(remaining - nextEditor)
        return
      }

      const remaining = total - (isSidebarOpen ? sidebarWidth : 0) - handles
      const nextEditor = applyKeyboardResize(editorWidth, key, {
        min: minPane,
        max: Math.max(minPane, remaining - minPane),
      })

      setEditorWidth(nextEditor)
      setPreviewWidth(remaining - nextEditor)
    }

  const workspaceTotal = workspaceRef.current?.clientWidth ?? window.innerWidth

  return (
    <div className="app">
      <div
        className="workspace"
        ref={workspaceRef}
        style={{
          gridTemplateColumns: isSidebarOpen
            ? `${sidebarWidth}px 8px ${editorWidth}px 8px ${previewWidth}px`
            : `${editorWidth}px 8px ${previewWidth}px`,
        }}
      >
        {isSidebarOpen ? (
          <FileSidebar
            library={library}
            exportSvgDisabled={!previewDocument || exportState === 'exporting'}
            svgExportState={exportState}
            onExportSvg={handleExportSvg}
            onHide={() => setIsSidebarOpen(false)}
          />
        ) : null}

        {isSidebarOpen ? (
          <div
            className="resize-handle"
            onMouseDown={(event) => startResize('sidebar', event.clientX)}
            onKeyDown={handleResizeKeyDown('sidebar')}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            tabIndex={0}
            aria-valuenow={sidebarWidth}
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={Math.max(
              MIN_SIDEBAR_WIDTH,
              workspaceTotal - (isSidebarOpen ? 16 : 8) - MIN_PANE_WIDTH * 2,
            )}
          />
        ) : null}

        <section className="editor-pane">
          <div className="pane-header">
            <div className="pane-title">
              <button
                className="ghost"
                type="button"
                onClick={() => setIsSidebarOpen((prev) => !prev)}
              >
                {isSidebarOpen ? 'Hide files' : 'Show files'}
              </button>
              <h2>Editor</h2>
              <span>{library.activeFile?.name ?? 'No file selected'}</span>
            </div>
            <span className="pane-status">{saveLabel}</span>
          </div>
          <div className="pane-body">
            {library.activeFile ? (
              <div className="editor-stack">
                <TypstEditor
                  value={library.activeContent}
                  path={library.activeVirtualPath}
                  diagnostics={diagnostics}
                  onChange={handleEditorChange}
                  onCursorClick={handleCursorClick}
                />
                {diagnostics.length > 0 ? (
                  <section className="error-pane" aria-label="Typst diagnostics">
                    <div className="error-pane-header">
                      <strong>Problems</strong>
                      <span>{diagnostics.length}</span>
                    </div>
                    <div className="error-list">
                      {diagnostics.map((diagnostic, index) => {
                        const location = diagnostic.range
                          ? `${diagnostic.range.start.line + 1}:${diagnostic.range.start.column + 1}`
                          : ''
                        const path = diagnostic.path.replace(/^\/@memory\//, '') || library.activeFile!.name
                        return (
                          <button
                            className={`error-item ${diagnostic.severity}`}
                            key={`${diagnostic.path}-${diagnostic.rawRange}-${index}`}
                            type="button"
                            onClick={() => library.openDiagnosticFile(diagnostic)}
                          >
                            <span className="error-severity">{diagnostic.severity}</span>
                            <span className="error-message">{diagnostic.message}</span>
                            <code>{path}{location ? `:${location}` : ''}</code>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="empty-state">
                <p>Select or create a file to start writing.</p>
              </div>
            )}
          </div>
        </section>

        <div
          className="resize-handle"
          onMouseDown={(event) => startResize('editor', event.clientX)}
          onKeyDown={handleResizeKeyDown('editor')}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor preview split"
          tabIndex={0}
          aria-valuenow={editorWidth}
          aria-valuemin={MIN_PANE_WIDTH}
          aria-valuemax={Math.max(
            MIN_PANE_WIDTH,
            workspaceTotal -
              (isSidebarOpen ? sidebarWidth + 16 : 8) -
              MIN_PANE_WIDTH * 2,
          )}
        />

        <PreviewPane
          previewLabel={previewLabel}
          autoPreview={autoPreview}
          onToggleAutoPreview={() => setAutoPreview((prev) => !prev)}
          onRenderOnce={handleRenderOnce}
          zoom={zoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          previewState={previewState}
          previewError={previewError}
          previewDocument={previewDocument}
          previewScrollTarget={previewScrollTarget}
        />
      </div>
      {library.undoIntent ? (
        <div className="snackbar" role="status">
          <span>Deleted {library.undoIntent.file.name}</span>
          <button className="ghost" type="button" onClick={library.handleUndoDelete}>
            Undo
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default App

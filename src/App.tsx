import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import { Button } from './components/ui/button'
import { Badge } from './components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from './components/ui/sheet'
import { PanelLeft, FileCode2 } from 'lucide-react'
import { EditorView } from '@codemirror/view'
import {
  useFileLibrary,
  type FileLibraryPipelineBridge,
} from './hooks/useFileLibrary'
import { usePreviewPipeline } from './hooks/usePreviewPipeline'

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [requestedSidebarWidth, setSidebarWidth] = useState(240)
  const [editorRatio, setEditorRatio] = useState(0.55)
  const [workspaceWidth, setWorkspaceWidth] = useState(window.innerWidth)
  const [activePane, setActivePane] = useState('editor')
  const [isFilesSheetOpen, setIsFilesSheetOpen] = useState(false)
  const isCompact = workspaceWidth <= 1100
  const sidebarVisible = isSidebarOpen && !isCompact
  const handles = sidebarVisible ? 16 : 8
  const sidebarWidth = Math.min(
    requestedSidebarWidth,
    Math.max(MIN_SIDEBAR_WIDTH, workspaceWidth - handles - MIN_PANE_WIDTH * 2),
  )
  const remainingWidth = workspaceWidth - (sidebarVisible ? sidebarWidth : 0) - handles
  const editorWidth = Math.min(
    Math.max(MIN_PANE_WIDTH, remainingWidth * editorRatio),
    remainingWidth - MIN_PANE_WIDTH,
  )
  const previewWidth = remainingWidth - editorWidth
  const [zoom, setZoom] = useState(1)

  // Updated after each commit, before file-library effects or user handlers.
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
    previewScrollTarget,
    cursorTarget,
    queueRender,
    handleCursorClick,
    handleSourceJump,
    handleExportSvg,
  } = pipeline

  useLayoutEffect(() => {
    pipelineBridgeRef.current = {
      beginSourceSwitch: pipeline.beginSourceSwitch,
      reportInvalidPath: pipeline.reportInvalidPath,
      bumpWorkspaceRevision: pipeline.bumpWorkspaceRevision,
    }
  })

  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const filesButtonRef = useRef<HTMLButtonElement | null>(null)
  const appShortcutRef = useRef<(action: AppShortcutAction) => void>(() => {})

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    // Observe the actual container, not just sidebar toggles: widths stay valid
    // across viewport changes while the user's preferred split is retained.
    const observer = new ResizeObserver(([entry]) => {
      setWorkspaceWidth(entry.contentRect.width)
    })
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [])

  const saveLabel = library.storageError ?? (
    library.saveState === 'saving'
      ? 'Saving...'
      : library.saveState === 'dirty'
        ? 'Unsaved changes'
        : 'All changes saved'
  )

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

  useLayoutEffect(() => {
    appShortcutRef.current = (action: AppShortcutAction) => {
      switch (action) {
      case 'render':
        handleRenderOnce()
        break
      case 'new-file':
        void library.createFile()
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
  })

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
    const minSidebar = MIN_SIDEBAR_WIDTH
    const minPane = MIN_PANE_WIDTH

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
        setSidebarWidth(nextSidebar)
        setEditorRatio(nextEditor / remaining)
        return
      }

      const remaining = total - (isSidebarOpen ? sidebarWidth : 0) - handles
      const nextEditor = Math.min(
        Math.max(initialEditor + delta, minPane),
        remaining - minPane,
      )
      setEditorRatio(nextEditor / remaining)
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
        setEditorRatio(nextEditor / remaining)
        return
      }

      const remaining = total - (isSidebarOpen ? sidebarWidth : 0) - handles
      const nextEditor = applyKeyboardResize(editorWidth, key, {
        min: minPane,
        max: Math.max(minPane, remaining - minPane),
      })

      setEditorRatio(nextEditor / remaining)
    }

  const workspaceTotal = workspaceWidth

  return (
    <Tabs className="app dark" value={activePane} onValueChange={setActivePane}>
      <header className="app-header">
        <div className="brand"><FileCode2 size={18} aria-hidden="true" /><h1>Typoff</h1><span>Local-first Typst workspace</span></div>
        <div className="app-header-actions">
          <Button ref={filesButtonRef} variant="outline" size="sm" onClick={() => isCompact ? setIsFilesSheetOpen(true) : setIsSidebarOpen((prev) => !prev)} aria-expanded={isCompact ? isFilesSheetOpen : isSidebarOpen}>
            <PanelLeft aria-hidden="true" />{isCompact ? 'Files' : isSidebarOpen ? 'Hide files' : 'Show files'}
          </Button>
          {isCompact ? <TabsList aria-label="Workspace view">
            <TabsTrigger value="editor" id="editor-tab" aria-controls="editor-panel">Editor</TabsTrigger>
            <TabsTrigger value="preview" id="preview-tab" aria-controls="preview-panel">Preview</TabsTrigger>
          </TabsList> : <Badge variant="outline">Offline ready</Badge>}
        </div>
      </header>
      <Sheet open={isCompact && isFilesSheetOpen} onOpenChange={setIsFilesSheetOpen}>
        <SheetContent side="left" className="files-sheet dark" showCloseButton={false}
          onCloseAutoFocus={(event) => {
            // The opener lives outside the Sheet to keep the workspace mounted.
            event.preventDefault()
            filesButtonRef.current?.focus()
          }}>
          <SheetTitle className="sr-only">Workspace files</SheetTitle>
          <SheetDescription className="sr-only">Create, import, export, rename and select your local Typst files.</SheetDescription>
          <FileSidebar library={library} exportSvgDisabled={!pipeline.canExportSvg || exportState === 'exporting'} svgExportState={exportState} onExportSvg={handleExportSvg} onHide={() => setIsFilesSheetOpen(false)} />
        </SheetContent>
      </Sheet>
      <div
        className={`workspace ${isCompact ? 'workspace-compact' : 'workspace-desktop'}`}
        ref={workspaceRef}
        style={{
          gridTemplateColumns: isCompact ? 'minmax(0, 1fr)' : isSidebarOpen
            ? `${sidebarWidth}px 8px ${editorWidth}px 8px ${previewWidth}px`
            : `${editorWidth}px 8px ${previewWidth}px`,
        }}
      >
        {sidebarVisible ? (
          <FileSidebar
            library={library}
            exportSvgDisabled={!pipeline.canExportSvg || exportState === 'exporting'}
            svgExportState={exportState}
            onExportSvg={handleExportSvg}
            onHide={() => setIsSidebarOpen(false)}
          />
        ) : null}

        {sidebarVisible ? (
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

        <section className="editor-pane" id="editor-panel" role={isCompact ? 'tabpanel' : undefined} aria-labelledby={isCompact ? 'editor-tab' : 'editor-heading'} hidden={isCompact && activePane !== 'editor'}
          onFocusCapture={(event) => {
            // Native focus after a hidden tab otherwise resets the DOM range
            // to offset zero. CodeMirror focus restores its retained selection.
            if (event.target instanceof HTMLElement && event.target.classList.contains('cm-content')) {
              EditorView.findFromDOM(event.target)?.focus()
            }
          }}>
          <div className="pane-header">
            <div className="pane-title">
              <h2 id="editor-heading">Editor</h2>
              <span>{library.activeFile?.name ?? 'No file selected'}</span>
            </div>
            <Badge variant="secondary" className="pane-status" role="status">{saveLabel}</Badge>
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
                  cursorTarget={cursorTarget}
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
                          <Button variant="ghost"
                            className={`error-item ${diagnostic.severity}`}
                            key={`${diagnostic.path}-${diagnostic.rawRange}-${index}`}
                            type="button"
                            onClick={() => library.openDiagnosticFile(diagnostic)}
                          >
                            <span className="error-severity">{diagnostic.severity}</span>
                            <span className="error-message">{diagnostic.message}</span>
                            <code>{path}{location ? `:${location}` : ''}</code>
                          </Button>
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

        {!isCompact ? <div
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
              MIN_PANE_WIDTH,
          )}
        /> : null}

        <PreviewPane
          compact={isCompact}
          hidden={isCompact && activePane !== 'preview'}
          previewLabel={previewLabel}
          onRenderOnce={handleRenderOnce}
          zoom={zoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          previewState={previewState}
          previewError={previewError}
          lastPreviewError={pipeline.lastPreviewError}
          previewDocument={previewDocument}
          previewScrollTarget={previewScrollTarget}
          onPageClick={(pageIndex, yPt) => void handleSourceJump(pageIndex, yPt)}
        />
      </div>
      {library.undoIntent ? (
        <div className="snackbar" role="status">
          <span>Deleted {library.undoIntent.file.name}</span>
          <Button variant="secondary" type="button" onClick={library.handleUndoDelete}>
            Undo
          </Button>
        </div>
      ) : null}
    </Tabs>
  )
}

export default App

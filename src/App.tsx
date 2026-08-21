import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { TypstEditor } from './TypstEditor'
import { deleteFile, listFiles, saveFile, type StoredFile } from './storage'
import { getPreviewPolicy } from './previewPolicy'
import {
  createRenderVersionGate,
  synchronizeRenderTransition,
} from './renderVersion'
import {
  compileTypstWorkspace,
  disposeTypstWorker,
  locateTypstCursor,
} from './typst'
import {
  buildTypstWorkspace,
  toTypstVirtualPath,
  type TypstDiagnostic,
} from './typstWorkspace'
import { VirtualPreview } from './VirtualPreview'
import type { TypstPageInfo } from './virtualPreview'

const DEFAULT_CONTENT = `// Typoff starter
#set page(width: 780pt, height: 1080pt, margin: 48pt)
#set text(font: "Libertinus Serif", size: 14pt)

= Typoff
An offline Typst editor built on Vite.

#heading(level: 2)[Quick demo]
- Real-time preview
- Local files
- Syntax highlighting

#show math.equation: it => box(stroke: 0.6pt + rgb("0f7b6c"), inset: 8pt)[it]

$sum_(i=1)^n i = n(n+1)/2$

#align(center)[#text(size: 22pt)[Happy typesetting.]]
`

type PreviewState = 'idle' | 'rendering' | 'error'
type SaveState = 'saved' | 'saving' | 'dirty'

const sortFiles = (items: StoredFile[]) =>
  [...items].sort((a, b) => b.updatedAt - a.updatedAt)

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `file-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function App() {
  const [files, setFiles] = useState<StoredFile[]>([])
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [activeContent, setActiveContent] = useState('')
  const [previewDocument, setPreviewDocument] = useState<{
    id: string
    pages: TypstPageInfo[]
  } | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>('idle')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<TypstDiagnostic[]>([])
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [autoPreview, setAutoPreview] = useState(true)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [editorWidth, setEditorWidth] = useState(520)
  const [previewWidth, setPreviewWidth] = useState(520)
  const [zoom, setZoom] = useState(1)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const [previewScrollTarget, setPreviewScrollTarget] = useState<{
    pageIndex: number
    nonce: number
  } | null>(null)

  const suppressSaveRef = useRef(false)
  const renderVersionRef = useRef(createRenderVersionGate())
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const renderTimerRef = useRef<number | null>(null)
  const renderInProgressRef = useRef(false)
  const pendingRenderRef = useRef(false)
  const latestContentRef = useRef('')
  const latestFilesRef = useRef(files)
  const latestActiveFileIdRef = useRef(activeFileId)
  const cursorLookupRef = useRef(0)
  latestFilesRef.current = files
  latestActiveFileIdRef.current = activeFileId


  const activeFile = useMemo(
    () => files.find((file) => file.id === activeFileId) ?? null,
    [files, activeFileId],
  )
  const activeVirtualPath = useMemo(() => {
    if (!activeFile) {
      return ''
    }
    try {
      return toTypstVirtualPath(activeFile.name)
    } catch {
      return ''
    }
  }, [activeFile])

  useEffect(() => {
    let isMounted = true

    const loadFiles = async () => {
      const stored = await listFiles()
      if (!isMounted) {
        return
      }

      if (stored.length === 0) {
        const initial: StoredFile = {
          id: createId(),
          name: 'Welcome.typ',
          content: DEFAULT_CONTENT,
          updatedAt: Date.now(),
        }
        await saveFile(initial)
        if (!isMounted) {
          return
        }
        setFiles([initial])
        openFile(initial)
        return
      }

      const sorted = sortFiles(stored)
      setFiles(sorted)
      openFile(sorted[0])
    }

    loadFiles()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    return () => disposeTypstWorker()
  }, [])

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
  }, [isSidebarOpen])

  useEffect(() => {
    if (!activeFileId) {
      return
    }

    if (suppressSaveRef.current) {
      suppressSaveRef.current = false
      return
    }

    const handle = window.setTimeout(async () => {
      const next = {
        id: activeFileId,
        name: activeFile?.name ?? 'Untitled.typ',
        content: activeContent,
        updatedAt: Date.now(),
      }
      setSaveState('saving')
      await saveFile(next)
      setFiles((prev) => {
        const updated = prev.filter((file) => file.id !== next.id)
        return sortFiles([...updated, next])
      })
      setSaveState('saved')
    }, 500)

    return () => window.clearTimeout(handle)
  }, [activeContent, activeFileId, activeFile?.name])

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
          const result = await compileTypstWorkspace(workspace)
          if (!renderVersionRef.current.isCurrent(renderVersion)) {
            return
          }

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
    if (!autoPreview || !getPreviewPolicy(activeContent.length).auto) {
      return
    }

    queueRender(false)

    return () => {
      if (renderTimerRef.current) {
        window.clearTimeout(renderTimerRef.current)
      }
    }
  }, [activeContent, activeFileId, autoPreview, workspaceRevision])

  useEffect(() => {
    if (autoPreview && !getPreviewPolicy(activeContent.length).auto) {
      setAutoPreview(false)
    }
  }, [activeContent, autoPreview])

  const openFile = (file: StoredFile) => {
    cursorLookupRef.current += 1
    setPreviewScrollTarget(null)
    synchronizeRenderTransition({
      gate: renderVersionRef.current,
      source: file.content,
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
    suppressSaveRef.current = true
    setActiveFileId(file.id)
    setActiveContent(file.content)
    setSaveState('saved')
    setRenamingId(null)
    setRenameDraft('')
  }

  const createFile = async () => {
    const baseName = 'Untitled'
    const existingNames = new Set(files.map((file) => file.name))
    let index = 1
    let name = `${baseName}.typ`
    while (existingNames.has(name)) {
      name = `${baseName} ${index}.typ`
      index += 1
    }

    const next: StoredFile = {
      id: createId(),
      name,
      content: DEFAULT_CONTENT,
      updatedAt: Date.now(),
    }

    await saveFile(next)
    setFiles((prev) => sortFiles([...prev, next]))
    openFile(next)
  }

  const handleRename = async () => {
    if (!renamingId) {
      return
    }

    const trimmed = renameDraft.trim()
    if (!trimmed) {
      setRenamingId(null)
      setRenameDraft('')
      return
    }

    const target = files.find((file) => file.id === renamingId)
    if (!target || target.name === trimmed) {
      setRenamingId(null)
      setRenameDraft('')
      return
    }

    try {
      const nextPath = toTypstVirtualPath(trimmed)
      const duplicate = files.some(
        (file) => file.id !== target.id && toTypstVirtualPath(file.name) === nextPath,
      )
      if (duplicate) {
        throw new Error(`Another file already uses ${trimmed}`)
      }
    } catch (error) {
      setPreviewState('error')
      setPreviewError(error instanceof Error ? error.message : 'Invalid Typst file path')
      return
    }

    const updated = { ...target, name: trimmed, updatedAt: Date.now() }
    await saveFile(updated)
    setFiles((prev) =>
      sortFiles(prev.map((file) => (file.id === updated.id ? updated : file))),
    )
    setWorkspaceRevision((revision) => revision + 1)
    setRenamingId(null)
    setRenameDraft('')
  }

  const handleDelete = async (file: StoredFile) => {
    if (!window.confirm(`Delete ${file.name}?`)) {
      return
    }

    await deleteFile(file.id)
    setFiles((prev) => prev.filter((item) => item.id !== file.id))
    setWorkspaceRevision((revision) => revision + 1)

    if (file.id === activeFileId) {
      const remaining = files.filter((item) => item.id !== file.id)
      if (remaining.length > 0) {
        openFile(sortFiles(remaining)[0])
      } else {
        cursorLookupRef.current += 1
        setPreviewScrollTarget(null)
        synchronizeRenderTransition({
          gate: renderVersionRef.current,
          source: '',
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
        setActiveFileId(null)
        setActiveContent('')
      }
    }
  }

  const saveLabel =
    saveState === 'saving'
      ? 'Saving...'
      : saveState === 'dirty'
        ? 'Unsaved changes'
        : 'All changes saved'

  const handleEditorChange = (value: string) => {
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
          value && autoPreview && getPreviewPolicy(value.length).auto
            ? 'rendering'
            : 'idle',
        )
        setPreviewError(null)
      },
    })
    setActiveContent(value)
    if (saveState !== 'dirty') {
      setSaveState('dirty')
    }
  }

  const handleCursorClick = async (offset: number) => {
    const currentActiveFileId = latestActiveFileIdRef.current
    const content = latestContentRef.current
    if (!currentActiveFileId || !content || !previewDocument) {
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
      setPreviewScrollTarget({ pageIndex: result.pageIndex, nonce: requestId })
    } catch {
      // A marker cannot be inserted safely at every Typst code position.
      // Leave the current preview position unchanged when lookup fails.
    }
  }

  const openDiagnosticFile = (diagnostic: TypstDiagnostic) => {
    const file = files.find((candidate) => {
      try {
        return toTypstVirtualPath(candidate.name) === diagnostic.path
      } catch {
        return false
      }
    })
    if (file && file.id !== activeFileId) {
      openFile(file)
    }
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
          <aside className="sidebar">
          <div className="sidebar-header">
            <div>
              <h2>Files</h2>
              <span className="file-count">{files.length}</span>
            </div>
            <div className="sidebar-actions">
              <button
                className="icon-button"
                onClick={createFile}
                type="button"
                aria-label="New file"
                title="New file"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 5v14M5 12h14"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="square"
                  />
                </svg>
              </button>
              <button
                className="ghost"
                onClick={() => setIsSidebarOpen(false)}
                type="button"
              >
                Hide
              </button>
            </div>
          </div>
          <div className="file-list">
            {files.map((file) => (
              <div
                key={file.id}
                className={`file-item ${
                  file.id === activeFileId ? 'active' : ''
                }`}
              >
                {renamingId === file.id ? (
                  <input
                    className="file-rename"
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={handleRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        handleRename()
                      }
                      if (event.key === 'Escape') {
                        setRenamingId(null)
                        setRenameDraft('')
                      }
                    }}
                    autoFocus
                  />
                ) : (
                  <button
                    className="file-name"
                    type="button"
                    onClick={() => openFile(file)}
                  >
                    {file.name}
                  </button>
                )}
                <div className="file-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(file.id)
                      setRenameDraft(file.name)
                    }}
                    aria-label={`Rename ${file.name}`}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(file)}
                    aria-label={`Delete ${file.name}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
        ) : null}

        {isSidebarOpen ? (
          <div
            className="resize-handle"
            onMouseDown={(event) => startResize('sidebar', event.clientX)}
            role="separator"
            aria-label="Resize file browser"
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
              <span>{activeFile?.name ?? 'No file selected'}</span>
            </div>
            <span className="pane-status">{saveLabel}</span>
          </div>
          <div className="pane-body">
            {activeFile ? (
              <div className="editor-stack">
                <TypstEditor
                  value={activeContent}
                  path={activeVirtualPath}
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
                        const path = diagnostic.path.replace(/^\/@memory\//, '') || activeFile.name
                        return (
                          <button
                            className={`error-item ${diagnostic.severity}`}
                            key={`${diagnostic.path}-${diagnostic.rawRange}-${index}`}
                            type="button"
                            onClick={() => openDiagnosticFile(diagnostic)}
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
          role="separator"
          aria-label="Resize editor and preview"
        />

        <section className="preview-pane">
          <div className="pane-header">
            <div className="pane-title">
              <h2>Preview</h2>
              <span>{previewLabel}</span>
            </div>
            <div className="pane-actions">
              <button
                className="ghost"
                type="button"
                onClick={() => setAutoPreview((prev) => !prev)}
              >
                {autoPreview ? 'Auto' : 'Manual'}
              </button>
              <button className="ghost" type="button" onClick={handleRenderOnce}>
                Render
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={handleZoomOut}
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
              </button>
              <button
                className="ghost"
                type="button"
                onClick={handleZoomReset}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={handleZoomIn}
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
              </button>
            </div>
          </div>
          <div className="pane-body preview-body">
            {previewState === 'error' && !previewDocument ? (
              <div className="preview-error">
                <p>{previewError ? 'Preview failed' : 'Typst found a problem'}</p>
                {previewError ? (
                  <pre>{previewError}</pre>
                ) : (
                  <span>See the highlighted source and Problems pane.</span>
                )}
              </div>
            ) : previewDocument ? (
              <VirtualPreview
                documentId={previewDocument.id}
                pages={previewDocument.pages}
                zoom={zoom}
                scrollTarget={previewScrollTarget}
              />
            ) : (
              <div className="empty-state">
                <p>Your Typst preview will appear here.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default App

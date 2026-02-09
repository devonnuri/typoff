import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { TypstEditor } from './TypstEditor'
import { deleteFile, listFiles, saveFile, type StoredFile } from './storage'
import { renderTypstSvg } from './typst'

const DEFAULT_CONTENT = `// Typoff starter
#set page(width: 780pt, height: 1080pt, margin: 48pt)
#set text(font: "IBM Plex Sans", size: 14pt)

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
  const [previewSvg, setPreviewSvg] = useState('')
  const [previewState, setPreviewState] = useState<PreviewState>('idle')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const suppressSaveRef = useRef(false)
  const renderTokenRef = useRef(0)

  const activeFile = useMemo(
    () => files.find((file) => file.id === activeFileId) ?? null,
    [files, activeFileId],
  )

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

  useEffect(() => {
    if (!activeContent) {
      setPreviewSvg('')
      setPreviewState('idle')
      setPreviewError(null)
      return
    }

    setPreviewState('rendering')
    const token = ++renderTokenRef.current

    const handle = window.setTimeout(async () => {
      try {
        const svg = await renderTypstSvg(activeContent)
        if (token !== renderTokenRef.current) {
          return
        }
        setPreviewSvg(svg)
        setPreviewState('idle')
        setPreviewError(null)
      } catch (error) {
        if (token !== renderTokenRef.current) {
          return
        }
        setPreviewState('error')
        setPreviewSvg('')
        setPreviewError(
          error instanceof Error ? error.message : 'Typst render failed',
        )
      }
    }, 250)

    return () => window.clearTimeout(handle)
  }, [activeContent])

  const openFile = (file: StoredFile) => {
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

    const updated = { ...target, name: trimmed, updatedAt: Date.now() }
    await saveFile(updated)
    setFiles((prev) =>
      sortFiles(prev.map((file) => (file.id === updated.id ? updated : file))),
    )
    setRenamingId(null)
    setRenameDraft('')
  }

  const handleDelete = async (file: StoredFile) => {
    if (!window.confirm(`Delete ${file.name}?`)) {
      return
    }

    await deleteFile(file.id)
    setFiles((prev) => prev.filter((item) => item.id !== file.id))

    if (file.id === activeFileId) {
      const remaining = files.filter((item) => item.id !== file.id)
      if (remaining.length > 0) {
        openFile(sortFiles(remaining)[0])
      } else {
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
    setActiveContent(value)
    if (saveState !== 'dirty') {
      setSaveState('dirty')
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <p className="brand-title">Typoff</p>
            <p className="brand-subtitle">Offline Typst Studio</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="primary" onClick={createFile} type="button">
            New file
          </button>
          <div className="status">
            <span>{saveLabel}</span>
            <span>|</span>
            <span>
              {previewState === 'rendering'
                ? 'Rendering preview'
                : previewState === 'error'
                  ? 'Preview error'
                  : 'Preview ready'}
            </span>
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Files</h2>
            <span>{files.length}</span>
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

        <section className="editor-pane">
          <div className="pane-header">
            <h2>Editor</h2>
            <span>{activeFile?.name ?? 'No file selected'}</span>
          </div>
          <div className="pane-body">
            {activeFile ? (
              <TypstEditor
                value={activeContent}
                onChange={handleEditorChange}
              />
            ) : (
              <div className="empty-state">
                <p>Select or create a file to start writing.</p>
              </div>
            )}
          </div>
        </section>

        <section className="preview-pane">
          <div className="pane-header">
            <h2>Preview</h2>
            <span>Live Typst render</span>
          </div>
          <div className="pane-body preview-body">
            {previewState === 'error' ? (
              <div className="preview-error">
                <p>Typst compile error</p>
                <pre>{previewError}</pre>
              </div>
            ) : previewSvg ? (
              <div
                className="preview-surface"
                dangerouslySetInnerHTML={{ __html: previewSvg }}
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

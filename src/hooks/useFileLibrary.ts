import { useEffect, useMemo, useRef, useState } from 'react'
import { DraftLibrary } from '../draftJournal'
import { createDeleteIntent, UNDO_WINDOW_MS } from '../deleteUndo'
import { openTypstFile, saveTypstFile } from '../fileIo'
import { deleteFile, listFiles, saveFile, type StoredFile } from '../storage'
import { toTypstVirtualPath, type TypstDiagnostic } from '../typstWorkspace'

export type SaveState = 'saved' | 'saving' | 'dirty'
export type UndoIntent = ReturnType<typeof createDeleteIntent>

// Subset of the preview pipeline API that file operations need to stay in
// sync with the render pipeline. Populated by App once both hooks have run;
// every consumer invokes it from effects/handlers, never during render.
export interface FileLibraryPipelineBridge {
  beginSourceSwitch: (source: string) => void
  reportInvalidPath: (message: string) => void
  bumpWorkspaceRevision: () => void
}

// prettier-ignore
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

export const sortFiles = (items: StoredFile[]) =>
  [...items].sort((a, b) => b.updatedAt - a.updatedAt)

export const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `file-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

interface UseFileLibraryOptions {
  pipelineBridge: React.RefObject<FileLibraryPipelineBridge | null>
}

export function useFileLibrary({ pipelineBridge }: UseFileLibraryOptions) {
  const [files, setFiles] = useState<StoredFile[]>([])
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [activeContent, setActiveContent] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [undoIntent, setUndoIntent] = useState<UndoIntent | null>(null)

  const draftsRef = useRef<DraftLibrary | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const latestContentRef = useRef('')
  const latestFilesRef = useRef(files)
  const latestActiveFileIdRef = useRef<string | null>(null)

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

  const openFile = (requested: StoredFile) => {
    const file = draftsRef.current?.get(requested.id)
    if (!file) return
    pipelineBridge.current!.beginSourceSwitch(file.content)
    latestActiveFileIdRef.current = file.id
    latestContentRef.current = file.content
    setActiveFileId(file.id)
    setActiveContent(file.content)
    setRenamingId(null)
    setRenameDraft('')
    void draftsRef.current!.flush()
  }

  useEffect(() => {
    let isMounted = true
    // A blocked localStorage still permits IndexedDB saving, with unload warning.
    let journal: Storage
    try { journal = window.localStorage } catch {
      journal = { get length(): number { throw new Error('Recovery storage blocked') },
        key() { return null }, getItem() { throw new Error('Recovery storage blocked') },
        setItem() { throw new Error('Recovery storage blocked') }, removeItem() {}, clear() {} }
    }
    const drafts = new DraftLibrary({ listFiles, saveFile, deleteFile }, journal)
    draftsRef.current = drafts
    const unsubscribe = drafts.subscribe(() => {
      if (!isMounted) return
      const next = drafts.snapshot()
      latestFilesRef.current = next
      setFiles(next)
      setStorageError(drafts.error)
      setSaveState(drafts.saving ? 'saving' : drafts.dirty ? 'dirty' : 'saved')
    })
    let loading = false
    const load = async () => {
      if (loading) return
      loading = true
      try {
        const workspaceChanged = await drafts.load()
        if (!isMounted) return
        if (workspaceChanged && latestActiveFileIdRef.current) {
          // Recovered dependencies can fix a failed include without changing the
          // active id/source. Use the existing revision-driven render scheduling.
          pipelineBridge.current!.bumpWorkspaceRevision()
        }
        if (!drafts.snapshot().length && !drafts.loaded) return
        if (!drafts.snapshot().length && drafts.error) return
        if (!drafts.snapshot().length) {
          drafts.put({ id: createId(), name: 'Welcome.typ', content: DEFAULT_CONTENT, updatedAt: Date.now() })
        }
        // A user may have created/edited a file while startup was unavailable.
        // Reconcile the sidebar without replacing their current editor/selection.
        if (!latestActiveFileIdRef.current) openFile(drafts.snapshot()[0])
      } catch (error) {
        if (isMounted) setStorageError(`Could not load local files: ${String(error)}`)
      } finally { loading = false }
    }
    void load()
    const retry = window.setInterval(() => {
      if (!drafts.loaded) void load()
      if (drafts.dirty) void drafts.flush()
    }, 5000)
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (drafts.needsUnloadWarning) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      isMounted = false
      unsubscribe()
      window.clearInterval(retry)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      window.removeEventListener('beforeunload', beforeUnload)
      void drafts.flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!undoIntent) {
      return
    }

    const handle = window.setTimeout(() => {
      setUndoIntent(null)
    }, UNDO_WINDOW_MS)

    return () => window.clearTimeout(handle)
  }, [undoIntent])

  const createFile = async () => {
    const baseName = 'Untitled'
    const existingNames = new Set(latestFilesRef.current.map((file) => file.name))
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

    draftsRef.current!.put(next)
    openFile(next)
  }

  const handleImportFile = async () => {
    const opened = await openTypstFile()
    if (!opened) {
      return
    }

    const existingNames = new Set(latestFilesRef.current.map((file) => file.name))
    let name = opened.name
    let index = 1
    while (existingNames.has(name)) {
      const dotIndex = opened.name.lastIndexOf('.')
      const stem = dotIndex > 0 ? opened.name.slice(0, dotIndex) : opened.name
      const ext = dotIndex > 0 ? opened.name.slice(dotIndex) : ''
      name = `${stem} ${index}${ext}`
      index += 1
    }

    try {
      toTypstVirtualPath(name)
    } catch {
      // The picked file does not map to a valid Typst virtual path; skip it.
      return
    }

    const next: StoredFile = {
      id: createId(),
      name,
      content: opened.content,
      updatedAt: Date.now(),
    }

    draftsRef.current!.put(next)
    openFile(next)
  }

  const handleExportFile = async () => {
    if (!activeFile) {
      return
    }
    await saveTypstFile(activeFile.name, activeContent)
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

    const target = draftsRef.current?.get(renamingId)
    if (!target || target.name === trimmed) {
      setRenamingId(null)
      setRenameDraft('')
      return
    }

    try {
      const nextPath = toTypstVirtualPath(trimmed)
      const duplicate = latestFilesRef.current.some(
        (file) => file.id !== target.id && toTypstVirtualPath(file.name) === nextPath,
      )
      if (duplicate) {
        throw new Error(`Another file already uses ${trimmed}`)
      }
    } catch (error) {
      pipelineBridge.current!.reportInvalidPath(
        error instanceof Error ? error.message : 'Invalid Typst file path',
      )
      return
    }

    const updated = { ...target, name: trimmed, updatedAt: Date.now() }
    draftsRef.current!.put(updated)
    void draftsRef.current!.flush()
    pipelineBridge.current!.bumpWorkspaceRevision()
    setRenamingId(null)
    setRenameDraft('')
  }

  const handleDelete = async (requested: StoredFile) => {
    const file = draftsRef.current?.remove(requested.id)
    if (!file) return
    setUndoIntent(createDeleteIntent(file))
    pipelineBridge.current!.bumpWorkspaceRevision()
    if (file.id === latestActiveFileIdRef.current) {
      const remaining = draftsRef.current!.snapshot()
      if (remaining.length) openFile(remaining[0])
      else {
        pipelineBridge.current!.beginSourceSwitch('')
        latestActiveFileIdRef.current = null
        latestContentRef.current = ''
        setActiveFileId(null)
        setActiveContent('')
      }
    }
    await draftsRef.current!.flush()
  }

  const handleUndoDelete = async () => {
    if (!undoIntent) return
    const { file } = undoIntent
    setUndoIntent(null)
    draftsRef.current!.put(file)
    pipelineBridge.current!.bumpWorkspaceRevision()
    if (!latestActiveFileIdRef.current) openFile(file)
    await draftsRef.current!.flush()
  }

  const startRename = (file: StoredFile) => {
    setRenamingId(file.id)
    setRenameDraft(file.name)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameDraft('')
  }

  const changeActiveContent = (value: string) => {
    const id = latestActiveFileIdRef.current
    const file = id ? draftsRef.current?.get(id) : null
    if (!file) return
    latestContentRef.current = value
    setActiveContent(value)
    draftsRef.current!.put({ ...file, content: value, updatedAt: Date.now() })
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { void draftsRef.current?.flush() }, 500)
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

  return {
    // state
    files,
    activeFileId,
    activeContent,
    activeFile,
    activeVirtualPath,
    saveState,
    storageError,
    retrySave: () => draftsRef.current?.flush(),
    renamingId,
    renameDraft,
    undoIntent,
    // shared refs
    latestContentRef,
    latestFilesRef,
    latestActiveFileIdRef,
    // actions
    openFile,
    createFile,
    handleImportFile,
    handleExportFile,
    handleRename,
    handleDelete,
    handleUndoDelete,
    startRename,
    cancelRename,
    setRenameDraft,
    changeActiveContent,
    openDiagnosticFile,
  }
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildSavePayload } from '../autoSave'
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

  const suppressSaveRef = useRef(false)
  const latestContentRef = useRef('')
  const latestFilesRef = useRef(files)
  const latestActiveFileIdRef = useRef<string | null>(null)
  const latestActiveFileNameRef = useRef<string | undefined>(undefined)
  latestFilesRef.current = files
  latestActiveFileIdRef.current = activeFileId

  const activeFile = useMemo(
    () => files.find((file) => file.id === activeFileId) ?? null,
    [files, activeFileId],
  )
  latestActiveFileNameRef.current = activeFile?.name
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

  const openFile = (file: StoredFile) => {
    pipelineBridge.current!.beginSourceSwitch(file.content)
    suppressSaveRef.current = true
    setActiveFileId(file.id)
    setActiveContent(file.content)
    setSaveState('saved')
    setRenamingId(null)
    setRenameDraft('')
  }

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

  useEffect(() => {
    if (!activeFileId) {
      return
    }

    if (suppressSaveRef.current) {
      suppressSaveRef.current = false
      return
    }

    const handle = window.setTimeout(async () => {
      const next = buildSavePayload({
        activeFileId: latestActiveFileIdRef.current,
        latestName: latestActiveFileNameRef.current,
        latestContentRef,
      })
      if (!next) {
        return
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

    await saveFile(next)
    setFiles((prev) => sortFiles([...prev, next]))
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
      pipelineBridge.current!.reportInvalidPath(
        error instanceof Error ? error.message : 'Invalid Typst file path',
      )
      return
    }

    const updated = { ...target, name: trimmed, updatedAt: Date.now() }
    await saveFile(updated)
    setFiles((prev) =>
      sortFiles(prev.map((file) => (file.id === updated.id ? updated : file))),
    )
    pipelineBridge.current!.bumpWorkspaceRevision()
    setRenamingId(null)
    setRenameDraft('')
  }

  const handleDelete = async (file: StoredFile) => {
    // Capture the intent BEFORE deleting so Undo can restore this exact file.
    // Replacing a pending intent permanently deletes the previously deleted
    // file — only the most recent delete is undoable.
    setUndoIntent(createDeleteIntent(file))

    await deleteFile(file.id)
    setFiles((prev) => prev.filter((item) => item.id !== file.id))
    pipelineBridge.current!.bumpWorkspaceRevision()

    if (file.id === activeFileId) {
      const remaining = files.filter((item) => item.id !== file.id)
      if (remaining.length > 0) {
        openFile(sortFiles(remaining)[0])
      } else {
        pipelineBridge.current!.beginSourceSwitch('')
        setActiveFileId(null)
        setActiveContent('')
      }
    }
  }

  const handleUndoDelete = async () => {
    if (!undoIntent) {
      return
    }

    const { file } = undoIntent
    setUndoIntent(null)
    // saveFile upserts (idb put), so re-inserting restores the file.
    await saveFile(file)
    setFiles((prev) =>
      sortFiles([...prev.filter((item) => item.id !== file.id), file]),
    )
    if (!latestActiveFileIdRef.current) {
      openFile(file)
    }
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
    setActiveContent(value)
    if (saveState !== 'dirty') {
      setSaveState('dirty')
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

  return {
    // state
    files,
    activeFileId,
    activeContent,
    activeFile,
    activeVirtualPath,
    saveState,
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

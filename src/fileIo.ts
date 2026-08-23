// Minimal File System Access API typings. The full types are not part of
// every lib.dom target we build against, so declare only what we use.
type FilePickerAcceptType = {
  description?: string
  accept: Record<string, string[]>
}

type OpenFilePickerOptions = {
  types?: FilePickerAcceptType[]
  multiple?: boolean
}

type SaveFilePickerOptions = {
  suggestedName?: string
  types?: FilePickerAcceptType[]
}

type FileSystemFileHandleLike = {
  name?: string
  getFile: () => Promise<{
    name: string
    text: () => Promise<string>
  }>
}

type FileSystemWritableFileStreamLike = {
  write: (data: string) => Promise<void>
  close: () => Promise<void>
}

type FileSystemFileHandleWithWrite = {
  name?: string
  createWritable: () => Promise<FileSystemWritableFileStreamLike>
}

const TYPST_PICKER_TYPES: FilePickerAcceptType[] = [
  { description: 'Typst', accept: { 'text/plain': ['.typ'] } },
]

const getGlobalFn = (name: string): (() => unknown) | undefined => {
  const scope = globalThis as unknown as Record<string, unknown>
  const candidate = scope[name]
  return typeof candidate === 'function' ? (candidate as () => unknown) : undefined
}

export function isFileSystemAccessSupported(): boolean {
  return (
    typeof getGlobalFn('showOpenFilePicker') === 'function' &&
    typeof getGlobalFn('showSaveFilePicker') === 'function'
  )
}

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

export async function openTypstFile(): Promise<{
  name: string
  content: string
} | null> {
  const picker = getGlobalFn(
    'showOpenFilePicker',
  ) as unknown as
    | ((options?: OpenFilePickerOptions) => Promise<FileSystemFileHandleLike[]>)
    | undefined

  if (!picker) {
    return null
  }

  let handles: FileSystemFileHandleLike[]
  try {
    // In a browser globalThis === window, so this is the same call as
    // window.showOpenFilePicker(...).
    handles = await picker.call(globalThis, {
      types: TYPST_PICKER_TYPES,
      multiple: false,
    })
  } catch {
    // The user cancelled the picker (AbortError); treat any other picker
    // failure the same way so a rejected dialog never breaks the app.
    return null
  }

  const handle = handles?.[0]
  if (!handle) {
    return null
  }

  try {
    const file = await handle.getFile()
    const content = await file.text()
    return { name: file.name, content }
  } catch (error) {
    if (isAbortError(error)) {
      return null
    }
    throw error
  }
}

const triggerAnchorDownload = (name: string, content: string): void => {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function saveTypstFile(
  name: string,
  content: string,
): Promise<string | null> {
  const picker = getGlobalFn(
    'showSaveFilePicker',
  ) as unknown as
    | ((
        options?: SaveFilePickerOptions,
      ) => Promise<FileSystemFileHandleWithWrite>)
    | undefined

  if (picker) {
    try {
      const handle = await picker.call(globalThis, {
        suggestedName: name,
        types: TYPST_PICKER_TYPES,
      })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      return handle.name ?? name
    } catch (error) {
      if (isAbortError(error)) {
        return null
      }
      // Any other failure falls through to the anchor-download fallback.
    }
  }

  triggerAnchorDownload(name, content)
  return name
}

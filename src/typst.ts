import type { TypstDiagnostic, TypstWorkspace } from './typstWorkspace'
import type { TypstPageInfo } from './virtualPreview'

export type TypstCompileResult = {
  documentId: string | null
  pages: TypstPageInfo[]
  diagnostics: TypstDiagnostic[]
}

export type TypstPageResult = {
  documentId: string
  pageIndex: number
  svg: string
}

export type TypstCursorResult = {
  pageIndex: number
}

export type TypstExportedPage = {
  pageIndex: number
  svg: string
}

export type TypstExportResult = {
  documentId: string
  pages: TypstExportedPage[]
}

type TypstWorkerRequestBody =
  | { type: 'compile'; workspace: TypstWorkspace }
  | {
      type: 'render-page'
      documentId: string
      pageIndex: number
    }
  | { type: 'locate-cursor'; workspace: TypstWorkspace; offset: number }
  | {
      type: 'locate-source'
      documentId?: string
      workspace: TypstWorkspace
      pageIndex: number
      yPt: number
    }
  | { type: 'export-svg-pages'; documentId: string }

export type TypstWorkerRequest = TypstWorkerRequestBody & { id: number }

type TypstWorkerResponse =
  | ({ id: number; type: 'compile-result' } & TypstCompileResult)
  | ({ id: number; type: 'page-result' } & TypstPageResult)
  | ({ id: number; type: 'cursor-result' } & TypstCursorResult)
  | { id: number; type: 'source-result'; offset: number }
  | ({ id: number; type: 'export-result' } & TypstExportResult)
  | { id: number; type: 'error'; message: string }

export type TypstWorkerLike = {
  onmessage: ((event: MessageEvent<TypstWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: TypstWorkerRequest): void
  terminate(): void
}

type WorkerResult =
  | TypstCompileResult
  | TypstPageResult
  | TypstCursorResult
  | { offset: number }
  | TypstExportResult

type PendingRequest = {
  resolve(result: WorkerResult): void
  reject(error: Error): void
}

export function createTypstWorkerClient(
  worker: TypstWorkerLike,
  onFatalError?: () => void,
) {
  let nextId = 1
  let disposed = false
  const pending = new Map<number, PendingRequest>()

  const rejectPending = (error: Error) => {
    for (const request of pending.values()) {
      request.reject(error)
    }
    pending.clear()
  }

  const request = (message: TypstWorkerRequestBody) => {
    if (disposed) {
      return Promise.reject(new Error('Typst preview worker was disposed'))
    }
    const id = nextId++
    return new Promise<WorkerResult>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ id, ...message } as TypstWorkerRequest)
      } catch (error) {
        pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  worker.onmessage = (event) => {
    const response = event.data
    const waiting = pending.get(response.id)
    if (!waiting) {
      return
    }

    pending.delete(response.id)
    if (response.type === 'error') {
      waiting.reject(new Error(response.message))
    } else if (response.type === 'compile-result') {
      const { documentId, pages, diagnostics } = response
      waiting.resolve({ documentId, pages, diagnostics })
    } else if (response.type === 'page-result') {
      const { documentId, pageIndex, svg } = response
      waiting.resolve({ documentId, pageIndex, svg })
    } else if (response.type === 'export-result') {
      const { documentId, pages } = response
      waiting.resolve({ documentId, pages })
    } else if (response.type === 'source-result') {
      waiting.resolve({ offset: response.offset })
    } else {
      waiting.resolve({ pageIndex: response.pageIndex })
    }
  }

  worker.onerror = (event) => {
    rejectPending(new Error(event.message || 'Typst preview worker failed'))
    worker.terminate()
    disposed = true
    onFatalError?.()
  }

  return {
    compile(workspace: TypstWorkspace): Promise<TypstCompileResult> {
      return request({ type: 'compile', workspace }).then((result) => {
        if ('pages' in result && 'diagnostics' in result) {
          return result
        }
        throw new Error('Typst worker returned an unexpected page result')
      })
    },
    renderPage(documentId: string, pageIndex: number): Promise<TypstPageResult> {
      return request({ type: 'render-page', documentId, pageIndex }).then(
        (result) => {
          if ('svg' in result) {
            return result
          }
          throw new Error('Typst worker returned an unexpected compile result')
        },
      )
    },
    locateCursor(workspace: TypstWorkspace, offset: number): Promise<TypstCursorResult> {
      return request({ type: 'locate-cursor', workspace, offset }).then((result) => {
        if ('pageIndex' in result && !('documentId' in result)) {
          return result
        }
        throw new Error('Typst worker returned an unexpected cursor result')
      })
    },
    locateSource(
      workspace: TypstWorkspace,
      pageIndex: number,
      yPt: number,
    ): Promise<number> {
      return request({ type: 'locate-source', workspace, pageIndex, yPt }).then(
        (result) => {
          if ('offset' in result && !('pages' in result) && !('pageIndex' in result)) {
            return result.offset
          }
          throw new Error('Typst worker returned an unexpected source result')
        },
      )
    },
    exportSvgPages(documentId: string): Promise<TypstExportResult> {
      return request({ type: 'export-svg-pages', documentId }).then((result) => {
        if ('pages' in result && !('diagnostics' in result)) {
          return result
        }
        throw new Error('Typst worker returned an unexpected export result')
      })
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      rejectPending(new Error('Typst preview worker was disposed'))
    },
  }
}

let workerClient: ReturnType<typeof createTypstWorkerClient> | undefined
let workerGeneration = 0
let consecutiveFatalErrors = 0

const defaultWorkerFactory = (): TypstWorkerLike =>
  new Worker(new URL('./typst.worker.ts', import.meta.url), {
    type: 'module',
  }) as TypstWorkerLike

let workerFactory: () => TypstWorkerLike = defaultWorkerFactory

export function setTypstWorkerFactory(factory: () => TypstWorkerLike) {
  workerFactory = factory
}

export function getConsecutiveFatalErrorCount() {
  return consecutiveFatalErrors
}

/**
 * No-op-safe recovery helper: clears the fatal-error streak and drops the
 * current (dead) worker client so the next call spins up a fresh worker.
 * Returns true when there was a fatal error to recover from.
 */
export function retryAfterFatalError(): boolean {
  if (consecutiveFatalErrors === 0 && !workerClient) {
    return false
  }
  consecutiveFatalErrors = 0
  workerClient = undefined
  return true
}

function getWorkerClient() {
  if (!workerClient) {
    const worker = workerFactory()
    const client = createTypstWorkerClient(worker, () => {
      if (workerClient === client) {
        workerClient = undefined
        consecutiveFatalErrors += 1
      }
    })
    workerClient = client
  }
  return workerClient
}

let compilerCacheWarmup: Promise<void> | undefined

/** Let the production SW's precache own the first WASM download instead of
 * racing it with a second 28 MB worker fetch. Never block the editor, and bound
 * the wait so a failed/unsupported SW cannot make online compilation hang. */
function waitForCompilerCache() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) || navigator.serviceWorker.controller) return
  compilerCacheWarmup ??= new Promise<void>((resolve) => {
    const serviceWorker = navigator.serviceWorker
    const finish = () => {
      clearTimeout(timeout)
      serviceWorker.removeEventListener('controllerchange', onControllerChange)
      resolve()
    }
    const onControllerChange = () => { if (serviceWorker.controller) finish() }
    const timeout = setTimeout(finish, 8000)
    serviceWorker.addEventListener('controllerchange', onControllerChange)
    void serviceWorker.ready.then(onControllerChange, finish)
    onControllerChange()
  })
  return compilerCacheWarmup
}

export function compileTypstWorkspace(
  workspace: TypstWorkspace,
): Promise<TypstCompileResult> {
  const warmup = waitForCompilerCache()
  const generation = workerGeneration
  return warmup
    ? warmup.then(() => {
      if (generation !== workerGeneration) throw new Error('Typst preview worker was disposed')
      return getWorkerClient().compile(workspace)
    })
    : getWorkerClient().compile(workspace)
}

export function renderTypstPage(
  documentId: string,
  pageIndex: number,
): Promise<TypstPageResult> {
  return getWorkerClient().renderPage(documentId, pageIndex)
}

/**
 * Renders every page of a compiled document as SVG via the worker.
 * The Export-menu button wiring in App.tsx will call this through
 * exportCurrentDocument (src/exportDocument.ts) once the App conflict clears.
 */
export function exportTypstPages(
  documentId: string,
): Promise<TypstExportedPage[]> {
  return getWorkerClient().exportSvgPages(documentId).then((result) => result.pages)
}

export function locateTypstCursor(
  workspace: TypstWorkspace,
  offset: number,
): Promise<TypstCursorResult> {
  return getWorkerClient().locateCursor(workspace, offset)
}

/**
 * Maps a click at (pageIndex, yPt) in the rendered preview back to a source
 * character offset of the main file via the worker's line metadata table.
 */
export function locateSourceOffset(
  workspace: TypstWorkspace,
  pageIndex: number,
  yPt: number,
): Promise<number> {
  return getWorkerClient().locateSource(workspace, pageIndex, yPt)
}

export function disposeTypstWorker() {
  workerGeneration += 1
  workerClient?.dispose()
  workerClient = undefined
}

export function resetTypstWorkerForTest() {
  disposeTypstWorker()
  compilerCacheWarmup = undefined
  consecutiveFatalErrors = 0
  workerFactory = defaultWorkerFactory
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeTypstWorker)
}

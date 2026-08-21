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

type TypstWorkerRequestBody =
  | { type: 'compile'; workspace: TypstWorkspace }
  | {
      type: 'render-page'
      documentId: string
      pageIndex: number
    }

export type TypstWorkerRequest = TypstWorkerRequestBody & { id: number }

type TypstWorkerResponse =
  | ({ id: number; type: 'compile-result' } & TypstCompileResult)
  | ({ id: number; type: 'page-result' } & TypstPageResult)
  | { id: number; type: 'error'; message: string }

export type TypstWorkerLike = {
  onmessage: ((event: MessageEvent<TypstWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: TypstWorkerRequest): void
  terminate(): void
}

type WorkerResult = TypstCompileResult | TypstPageResult

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
    } else {
      const { documentId, pageIndex, svg } = response
      waiting.resolve({ documentId, pageIndex, svg })
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
        if ('pages' in result) {
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

function getWorkerClient() {
  if (!workerClient) {
    const worker = new Worker(new URL('./typst.worker.ts', import.meta.url), {
      type: 'module',
    }) as TypstWorkerLike
    const client = createTypstWorkerClient(worker, () => {
      if (workerClient === client) {
        workerClient = undefined
      }
    })
    workerClient = client
  }
  return workerClient
}

export function compileTypstWorkspace(
  workspace: TypstWorkspace,
): Promise<TypstCompileResult> {
  return getWorkerClient().compile(workspace)
}

export function renderTypstPage(
  documentId: string,
  pageIndex: number,
): Promise<TypstPageResult> {
  return getWorkerClient().renderPage(documentId, pageIndex)
}

export function disposeTypstWorker() {
  workerClient?.dispose()
  workerClient = undefined
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeTypstWorker)
}

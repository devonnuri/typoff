import type { TypstDiagnostic, TypstWorkspace } from './typstWorkspace'

type Rect = {
  lo: { x: number; y: number }
  hi: { x: number; y: number }
}

export type RenderOptions = {
  window?: Rect
}

export type TypstRenderResult = {
  svg: string
  diagnostics: TypstDiagnostic[]
}

type RenderRequest = {
  id: number
  type: 'render'
  workspace: TypstWorkspace
  options: RenderOptions
}

type RenderResponse =
  | ({ id: number; type: 'result' } & TypstRenderResult)
  | { id: number; type: 'error'; message: string }

export type TypstWorkerLike = {
  onmessage: ((event: MessageEvent<RenderResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: RenderRequest): void
  terminate(): void
}

type PendingRender = {
  resolve(result: TypstRenderResult): void
  reject(error: Error): void
}

export function createTypstWorkerClient(
  worker: TypstWorkerLike,
  onFatalError?: () => void,
) {
  let nextId = 1
  let disposed = false
  const pending = new Map<number, PendingRender>()

  const rejectPending = (error: Error) => {
    for (const request of pending.values()) {
      request.reject(error)
    }
    pending.clear()
  }

  worker.onmessage = (event) => {
    const response = event.data
    const request = pending.get(response.id)
    if (!request) {
      return
    }

    pending.delete(response.id)
    if (response.type === 'result') {
      request.resolve({ svg: response.svg, diagnostics: response.diagnostics })
    } else {
      request.reject(new Error(response.message))
    }
  }

  worker.onerror = (event) => {
    rejectPending(new Error(event.message || 'Typst preview worker failed'))
    worker.terminate()
    disposed = true
    onFatalError?.()
  }

  return {
    render(workspace: TypstWorkspace, options: RenderOptions = {}) {
      if (disposed) {
        return Promise.reject(new Error('Typst preview worker was disposed'))
      }
      const id = nextId++
      return new Promise<TypstRenderResult>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try {
          worker.postMessage({ id, type: 'render', workspace, options })
        } catch (error) {
          pending.delete(id)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
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

export function renderTypstWorkspace(
  workspace: TypstWorkspace,
  options: RenderOptions = {},
): Promise<TypstRenderResult> {
  return getWorkerClient().render(workspace, options)
}

export function disposeTypstWorker() {
  workerClient?.dispose()
  workerClient = undefined
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeTypstWorker)
}

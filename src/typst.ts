type Rect = {
  lo: { x: number; y: number }
  hi: { x: number; y: number }
}

export type RenderOptions = {
  window?: Rect
}

type RenderRequest = {
  id: number
  type: 'render'
  source: string
  options: RenderOptions
}

type RenderResponse =
  | { id: number; type: 'result'; svg: string }
  | { id: number; type: 'error'; message: string }

export type TypstWorkerLike = {
  onmessage: ((event: MessageEvent<RenderResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: RenderRequest): void
}

type PendingRender = {
  resolve(svg: string): void
  reject(error: Error): void
}

export function createTypstWorkerClient(worker: TypstWorkerLike) {
  let nextId = 1
  const pending = new Map<number, PendingRender>()

  worker.onmessage = (event) => {
    const response = event.data
    const request = pending.get(response.id)
    if (!request) {
      return
    }

    pending.delete(response.id)
    if (response.type === 'result') {
      request.resolve(response.svg)
    } else {
      request.reject(new Error(response.message))
    }
  }

  worker.onerror = (event) => {
    const error = new Error(event.message || 'Typst preview worker failed')
    for (const request of pending.values()) {
      request.reject(error)
    }
    pending.clear()
  }

  return {
    render(source: string, options: RenderOptions = {}) {
      const id = nextId++
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, type: 'render', source, options })
      })
    },
  }
}

let workerClient: ReturnType<typeof createTypstWorkerClient> | undefined

function getWorkerClient() {
  if (!workerClient) {
    const worker = new Worker(new URL('./typst.worker.ts', import.meta.url), {
      type: 'module',
    }) as TypstWorkerLike
    workerClient = createTypstWorkerClient(worker)
  }
  return workerClient
}

export function renderTypstSvg(
  source: string,
  options: RenderOptions = {},
): Promise<string> {
  return getWorkerClient().render(source, options)
}

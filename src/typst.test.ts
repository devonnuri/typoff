import { describe, expect, it } from 'vitest'
import { createTypstWorkerClient, type TypstWorkerLike } from './typst'

class FakeWorker implements TypstWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: unknown[] = []
  terminated = false

  postMessage(message: unknown) {
    this.posted.push(message)
  }

  reply(message: unknown) {
    this.onmessage?.({ data: message } as MessageEvent)
  }

  terminate() {
    this.terminated = true
  }
}

const workspace = {
  mainFilePath: '/@memory/main.typ',
  files: [
    { path: '/@memory/main.typ', content: '#import "shared.typ"' },
    { path: '/@memory/shared.typ', content: '= Shared' },
  ],
}

describe('Typst worker client', () => {
  it('sends the complete workspace to the render worker', async () => {
    const worker = new FakeWorker()
    const client = createTypstWorkerClient(worker)
    const rendering = client.render(workspace, {})

    expect(worker.posted).toEqual([
      { id: 1, type: 'render', workspace, options: {} },
    ])

    worker.reply({
      id: 1,
      type: 'result',
      svg: '<svg />',
      diagnostics: [],
    })
    await expect(rendering).resolves.toEqual({ svg: '<svg />', diagnostics: [] })
  })

  it('returns structured diagnostics without a JavaScript stack trace', async () => {
    const worker = new FakeWorker()
    const client = createTypstWorkerClient(worker)
    const rendering = client.render(workspace, {})
    const diagnostics = [
      {
        severity: 'error',
        path: '/main.typ',
        message: 'expected expression',
        range: {
          start: { line: 2, column: 9 },
          end: { line: 2, column: 10 },
        },
        trace: [],
      },
    ]

    worker.reply({ id: 1, type: 'result', svg: '', diagnostics })

    await expect(rendering).resolves.toEqual({ svg: '', diagnostics })
  })

  it('routes concurrent responses to the matching request', async () => {
    const worker = new FakeWorker()
    const client = createTypstWorkerClient(worker)
    const first = client.render({ ...workspace, mainFilePath: '/first.typ' }, {})
    const second = client.render({ ...workspace, mainFilePath: '/second.typ' }, {})

    worker.reply({ id: 2, type: 'result', svg: '<svg>second</svg>', diagnostics: [] })
    worker.reply({ id: 1, type: 'result', svg: '<svg>first</svg>', diagnostics: [] })

    await expect(first).resolves.toEqual({ svg: '<svg>first</svg>', diagnostics: [] })
    await expect(second).resolves.toEqual({ svg: '<svg>second</svg>', diagnostics: [] })
  })

  it('terminates the worker and rejects pending work on dispose', async () => {
    const worker = new FakeWorker()
    const client = createTypstWorkerClient(worker)
    const rendering = client.render(workspace, {})

    client.dispose()

    await expect(rendering).rejects.toThrow(/disposed/i)
    expect(worker.terminated).toBe(true)
  })
})

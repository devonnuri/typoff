import { describe, expect, it } from 'vitest'
import { createTypstWorkerClient, type TypstWorkerLike } from './typst'

class FakeWorker implements TypstWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: unknown[] = []

  postMessage(message: unknown) {
    this.posted.push(message)
  }

  reply(message: unknown) {
    this.onmessage?.({ data: message } as MessageEvent)
  }
}

describe('Typst worker client', () => {
  it('renders through a worker instead of compiling on the UI thread', async () => {
    const worker = new FakeWorker()
    const client = createTypstWorkerClient(worker)
    const rendering = client.render('= long document', {})

    expect(worker.posted).toEqual([
      { id: 1, type: 'render', source: '= long document', options: {} },
    ])

    worker.reply({ id: 1, type: 'result', svg: '<svg />' })
    await expect(rendering).resolves.toBe('<svg />')
  })

  it('routes concurrent responses to the matching request', async () => {
    const worker = new FakeWorker()
    const client = createTypstWorkerClient(worker)
    const first = client.render('first', {})
    const second = client.render('second', {})

    worker.reply({ id: 2, type: 'result', svg: '<svg>second</svg>' })
    worker.reply({ id: 1, type: 'result', svg: '<svg>first</svg>' })

    await expect(first).resolves.toBe('<svg>first</svg>')
    await expect(second).resolves.toBe('<svg>second</svg>')
  })
})

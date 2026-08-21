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
  it('compiles the complete workspace and returns page metadata', async () => {
    const worker = new FakeWorker()
    const client = createTypstWorkerClient(worker)
    const compiling = client.compile(workspace)

    expect(worker.posted).toEqual([{ id: 1, type: 'compile', workspace }])
    worker.reply({
      id: 1,
      type: 'compile-result',
      documentId: 'doc-1',
      pages: [{ pageOffset: 0, width: 780, height: 1080 }],
      diagnostics: [],
    })

    await expect(compiling).resolves.toMatchObject({ documentId: 'doc-1', pages: [{ height: 1080 }] })
  })

  it('requests a single page from an already compiled document', async () => {
    const worker = new FakeWorker()
    const client = createTypstWorkerClient(worker)
    const rendering = client.renderPage('doc-1', 4)

    expect(worker.posted).toEqual([{ id: 1, type: 'render-page', documentId: 'doc-1', pageIndex: 4 }])
    worker.reply({ id: 1, type: 'page-result', documentId: 'doc-1', pageIndex: 4, svg: '<svg />' })

    await expect(rendering).resolves.toEqual({ documentId: 'doc-1', pageIndex: 4, svg: '<svg />' })
  })

  it('locates an editor cursor in the compiled workspace', async () => {
    const worker = new FakeWorker()
    const client = createTypstWorkerClient(worker)
    const locating = client.locateCursor(workspace, 17)

    expect(worker.posted).toEqual([
      { id: 1, type: 'locate-cursor', workspace, offset: 17 },
    ])
    worker.reply({ id: 1, type: 'cursor-result', pageIndex: 2 })

    await expect(locating).resolves.toEqual({ pageIndex: 2 })
  })

  it('routes out-of-order responses to matching requests', async () => {
    const worker = new FakeWorker()
    const client = createTypstWorkerClient(worker)
    const first = client.renderPage('doc-1', 1)
    const second = client.renderPage('doc-1', 2)

    worker.reply({ id: 2, type: 'page-result', documentId: 'doc-1', pageIndex: 2, svg: 'two' })
    worker.reply({ id: 1, type: 'page-result', documentId: 'doc-1', pageIndex: 1, svg: 'one' })

    await expect(first).resolves.toMatchObject({ pageIndex: 1, svg: 'one' })
    await expect(second).resolves.toMatchObject({ pageIndex: 2, svg: 'two' })
  })

  it('terminates the worker and rejects pending work on dispose', async () => {
    const worker = new FakeWorker()
    const client = createTypstWorkerClient(worker)
    const compiling = client.compile(workspace)

    client.dispose()

    await expect(compiling).rejects.toThrow(/disposed/i)
    expect(worker.terminated).toBe(true)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileTypstWorkspace, disposeTypstWorker, resetTypstWorkerForTest, setTypstWorkerFactory, type TypstWorkerLike } from './typst'

const workspace = { mainFilePath: '/@memory/main.typ', files: [{ path: '/@memory/main.typ', content: 'Hello' }] }

function fixture() {
  vi.stubEnv('PROD', true)
  vi.useFakeTimers()
  const serviceWorker = Object.assign(new EventTarget(), {
    controller: null as object | null,
    ready: new Promise<never>(() => {}),
  })
  vi.stubGlobal('navigator', { serviceWorker })
  const posted = vi.fn()
  const worker: TypstWorkerLike = { onmessage: null, onerror: null, postMessage: posted, terminate: vi.fn() }
  const factory = vi.fn(() => worker)
  setTypstWorkerFactory(factory)
  const reply = () => worker.onmessage?.({ data: { id: 1, type: 'compile-result', documentId: 'doc-1', pages: [], diagnostics: [] } } as MessageEvent)
  return { serviceWorker, posted, factory, reply }
}

afterEach(() => {
  resetTypstWorkerForTest()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('bounded production compiler precache warmup', () => {
  it('does not create a worker after disposal while precaching is pending', async () => {
    const { serviceWorker, factory } = fixture()
    const compiling = compileTypstWorkspace(workspace)
    disposeTypstWorker()
    serviceWorker.controller = {}
    serviceWorker.dispatchEvent(new Event('controllerchange'))
    await expect(compiling).rejects.toThrow(/disposed/)
    expect(factory).not.toHaveBeenCalled()
  })
  it('starts the worker only after the SW controls the page, avoiding duplicate cold WASM fetches', async () => {
    const { serviceWorker, factory, reply } = fixture()
    const compiling = compileTypstWorkspace(workspace)
    expect(factory).not.toHaveBeenCalled()
    serviceWorker.controller = {}
    serviceWorker.dispatchEvent(new Event('controllerchange'))
    await Promise.resolve()
    expect(factory).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    reply()
    await expect(compiling).resolves.toMatchObject({ documentId: 'doc-1' })
  })

  it('falls back to online compilation after eight seconds when SW installation stalls', async () => {
    const { factory, reply } = fixture()
    const compiling = compileTypstWorkspace(workspace)
    await vi.advanceTimersByTimeAsync(7999)
    expect(factory).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(factory).toHaveBeenCalledOnce()
    reply()
    await expect(compiling).resolves.toMatchObject({ documentId: 'doc-1' })
  })

  it('starts immediately on already-controlled offline pages', async () => {
    const { serviceWorker, factory, reply } = fixture()
    serviceWorker.controller = {}
    const compiling = compileTypstWorkspace(workspace)
    expect(factory).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    reply()
    await expect(compiling).resolves.toMatchObject({ documentId: 'doc-1' })
  })

  it('does not wait when service workers are unsupported', async () => {
    const { factory, reply } = fixture()
    vi.stubGlobal('navigator', {})
    const compiling = compileTypstWorkspace(workspace)
    expect(factory).toHaveBeenCalledOnce()
    reply()
    await expect(compiling).resolves.toMatchObject({ documentId: 'doc-1' })
  })
})

import type { RenderSession } from '@myriaddreamin/typst.ts'
import { describe, expect, it } from 'vitest'
import {
  RenderSessionCache,
  renderDocumentPage,
  shouldReuseSession,
  type TypstRendererLike,
} from './renderSessionCache'
import type { TypstPageInfo } from './virtualPreview'

const ARTIFACT_A = new Uint8Array([1, 1])
const ARTIFACT_B = new Uint8Array([2, 2])

const PAGE: TypstPageInfo = {
  pageOffset: 1080,
  width: 595,
  height: 842,
}

function pageSvg(sessionMarker: string): string {
  return (
    `<svg viewBox="0 0 595 ${PAGE.pageOffset + PAGE.height}">` +
    `<g class="typst-page" transform="translate(0, ${PAGE.pageOffset})">` +
    `<rect x="0" y="0" width="10" height="10" data-session="${sessionMarker}" />` +
    '</g>' +
    '<foreignObject><div>dropped</div></foreignObject>' +
    '</svg>'
  )
}

interface FakeSession {
  marker: string
}

function createFakeRenderer(options?: { failDiffOn?: FakeSession[] }) {
  const createdSessions: FakeSession[] = []
  let moduleCount = 0
  const manipulateCalls: { session: FakeSession; action: string; data?: Uint8Array }[] = []
  const diffCalls: { session: FakeSession; window?: unknown }[] = []
  const runWithSessionCalls: number[] = []
  const state: { failDiffOn?: FakeSession[] } = { failDiffOn: options?.failDiffOn }

  const renderer: TypstRendererLike = {
    async createModule(artifact) {
      moduleCount += 1
      const session: FakeSession = { marker: `module-${moduleCount}-${artifact[0]}` }
      createdSessions.push(session)
      return session as unknown as RenderSession
    },
    manipulateData(opts) {
      manipulateCalls.push({
        session: opts.renderSession as unknown as FakeSession,
        action: opts.action,
        data: opts.data,
      })
    },
    renderSvgDiff(opts) {
      const session = opts.renderSession as unknown as FakeSession
      diffCalls.push({ session, window: opts.window })
      if (state.failDiffOn?.includes(session)) {
        throw new Error('renderer session is broken')
      }
      return pageSvg(session.marker)
    },
    runWithSession(fn) {
      runWithSessionCalls.push(runWithSessionCalls.length)
      const session: FakeSession = { marker: `throwaway-${runWithSessionCalls.length}` }
      createdSessions.push(session)
      return fn(session as unknown as RenderSession)
    },
  }

  return {
    renderer,
    state,
    getModuleCount: () => moduleCount,
    createdSessions,
    manipulateCalls,
    diffCalls,
    runWithSessionCount: () => runWithSessionCalls.length,
  }
}

function toCacheEntry(session: RenderSession) {
  return session as unknown as FakeSession
}

describe('shouldReuseSession', () => {
  it('reuses only when an open session matches the document id', () => {
    expect(shouldReuseSession({ documentId: 'doc-1' }, 'doc-1')).toBe(true)
    expect(shouldReuseSession({ documentId: 'doc-1' }, 'doc-2')).toBe(false)
    expect(shouldReuseSession(undefined, 'doc-1')).toBe(false)
  })
})

describe('RenderSessionCache', () => {
  it('creates a module once and reuses the slot for later compiles', async () => {
    const fake = createFakeRenderer()
    const cache = new RenderSessionCache()

    const first = await cache.acquire(fake.renderer, 'doc-1', ARTIFACT_A)
    expect(toCacheEntry(first).marker).toBe('module-1-1')
    expect(fake.getModuleCount()).toBe(1)
    expect(fake.manipulateCalls).toHaveLength(0)

    const second = await cache.acquire(fake.renderer, 'doc-2', ARTIFACT_B)
    expect(toCacheEntry(second)).toBe(toCacheEntry(first))
    expect(fake.getModuleCount()).toBe(1)
    expect(fake.manipulateCalls).toEqual([
      { session: toCacheEntry(first), action: 'reset', data: ARTIFACT_B },
    ])
    expect(cache.get('doc-2')).toBe(second)
    expect(cache.get('doc-1')).toBeUndefined()
  })

  it('falls back to creating a fresh module when the cached reset fails', async () => {
    const fake = createFakeRenderer()
    const cache = new RenderSessionCache()
    const first = await cache.acquire(fake.renderer, 'doc-1', ARTIFACT_A)

    fake.renderer.manipulateData = () => {
      throw new Error('reset failed')
    }

    const replacement = await cache.acquire(fake.renderer, 'doc-2', ARTIFACT_B)
    expect(toCacheEntry(replacement)).not.toBe(toCacheEntry(first))
    expect(fake.getModuleCount()).toBe(2)
    expect(cache.get('doc-2')).toBe(replacement)
  })

  it('drops the entry on invalidate', async () => {
    const fake = createFakeRenderer()
    const cache = new RenderSessionCache()
    await cache.acquire(fake.renderer, 'doc-1', ARTIFACT_A)
    cache.invalidate()
    expect(cache.get('doc-1')).toBeUndefined()
    await cache.acquire(fake.renderer, 'doc-1', ARTIFACT_A)
    expect(fake.getModuleCount()).toBe(2)
  })
})

describe('renderDocumentPage', () => {
  it('renders repeated pages of one document without re-injecting the artifact', async () => {
    const fake = createFakeRenderer()
    const cache = new RenderSessionCache()
    await cache.acquire(fake.renderer, 'doc-1', ARTIFACT_A)
    fake.manipulateCalls.length = 0

    const first = await renderDocumentPage(
      fake.renderer,
      cache,
      'doc-1',
      ARTIFACT_A,
      0,
      PAGE,
    )
    const second = await renderDocumentPage(
      fake.renderer,
      cache,
      'doc-1',
      ARTIFACT_A,
      0,
      PAGE,
    )

    // Both renders hit the same long-lived session with no artifact reset.
    expect(fake.diffCalls).toHaveLength(2)
    expect(fake.diffCalls[0].session).toBe(fake.diffCalls[1].session)
    expect(fake.diffCalls[0].session.marker).toBe('module-1-1')
    expect(fake.manipulateCalls).toHaveLength(0)
    expect(fake.runWithSessionCount()).toBe(0)
    // Post-processing unchanged: foreign objects stripped, page isolated/cropped.
    for (const svg of [first, second]) {
      expect(svg).not.toContain('<foreignObject')
      expect(svg).toContain('data-session="module-1-1"')
      expect(svg).toContain(`viewBox="0 0 595 ${PAGE.height}"`)
    }
  })

  it('recovers through a throwaway session when the cached session fails', async () => {
    const fake = createFakeRenderer()
    const cache = new RenderSessionCache()
    const broken = await cache.acquire(fake.renderer, 'doc-1', ARTIFACT_A)
    fake.state.failDiffOn = [toCacheEntry(broken)]

    const svg = await renderDocumentPage(
      fake.renderer,
      cache,
      'doc-1',
      ARTIFACT_A,
      0,
      PAGE,
    )

    expect(svg).toContain('data-session="throwaway-1"')
    expect(svg).not.toContain('<foreignObject')
    expect(fake.runWithSessionCount()).toBe(1)
    expect(fake.manipulateCalls).toEqual([
      { session: fake.createdSessions[1], action: 'reset', data: ARTIFACT_A },
    ])
    // The poisoned slot is dropped so the next compile rebuilds a real module.
    expect(cache.get('doc-1')).toBeUndefined()
  })

  it('uses the throwaway path when no session is cached (cold start)', async () => {
    const fake = createFakeRenderer()
    const cache = new RenderSessionCache()

    const svg = await renderDocumentPage(
      fake.renderer,
      cache,
      'doc-1',
      ARTIFACT_A,
      0,
      PAGE,
    )

    expect(fake.getModuleCount()).toBe(0)
    expect(fake.runWithSessionCount()).toBe(1)
    expect(fake.diffCalls[0].session.marker).toBe('throwaway-1')
    expect(svg).toContain('data-session="throwaway-1"')
  })

  it('reuses one warm session across documents with a single reset on switch', async () => {
    const fake = createFakeRenderer()
    const cache = new RenderSessionCache()
    await cache.acquire(fake.renderer, 'doc-1', ARTIFACT_A)
    fake.manipulateCalls.length = 0

    const first = await renderDocumentPage(
      fake.renderer,
      cache,
      'doc-1',
      ARTIFACT_A,
      0,
      PAGE,
    )
    await cache.acquire(fake.renderer, 'doc-2', ARTIFACT_B)
    const second = await renderDocumentPage(
      fake.renderer,
      cache,
      'doc-2',
      ARTIFACT_B,
      0,
      PAGE,
    )

    expect(fake.manipulateCalls).toHaveLength(1) // only the doc switch reset
    expect(fake.getModuleCount()).toBe(1) // no new module for the second document
    expect(fake.diffCalls[0].session.marker).toBe('module-1-1')
    expect(fake.diffCalls[1].session.marker).toBe('module-1-1')
    expect(first).toBe(second)
  })
})

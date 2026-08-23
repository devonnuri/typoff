import { describe, expect, it } from 'vitest'
import { buildSavePayload } from './autoSave'

describe('buildSavePayload', () => {
  it('returns null when there is no active file', () => {
    expect(
      buildSavePayload({
        activeFileId: null,
        latestName: 'Notes.typ',
        latestContentRef: { current: '#hello' },
      }),
    ).toBeNull()
  })

  it('returns null when content is empty', () => {
    expect(
      buildSavePayload({
        activeFileId: 'file-1',
        latestName: 'Notes.typ',
        latestContentRef: { current: '' },
      }),
    ).toBeNull()
  })

  it('uses the ref\u2019s current content at call time, not a stale snapshot', () => {
    const latestContentRef = { current: 'content captured when effect ran' }
    expect(
      buildSavePayload({
        activeFileId: 'file-1',
        latestName: 'Notes.typ',
        latestContentRef,
      }),
    ).toMatchObject({ content: 'content captured when effect ran' })

    // Simulate typing that races past the debounce: the ref moves on.
    latestContentRef.current = 'newer content typed after debounce started'
    const refreshed = buildSavePayload({
      activeFileId: 'file-1',
      latestName: 'Notes.typ',
      latestContentRef,
    })
    expect(refreshed).toMatchObject({
      content: 'newer content typed after debounce started',
    })
  })

  it('falls back to Untitled.typ when the latest name is undefined', () => {
    const payload = buildSavePayload({
      activeFileId: 'file-1',
      latestName: undefined,
      latestContentRef: { current: '#hello' },
    })
    expect(payload).toMatchObject({
      id: 'file-1',
      name: 'Untitled.typ',
      content: '#hello',
    })
    expect(typeof payload?.updatedAt).toBe('number')
  })

  it('prefers the provided name over the fallback', () => {
    const payload = buildSavePayload({
      activeFileId: 'file-1',
      latestName: 'Renamed.typ',
      latestContentRef: { current: '#hello' },
    })
    expect(payload).toMatchObject({ id: 'file-1', name: 'Renamed.typ' })
  })
})

import { describe, expect, it } from 'vitest'
import {
  applyDoubleBufferUpdate,
  type PreviewBufferState,
} from './previewBuffer'

describe('double-buffered preview state', () => {
  const doc = (id: string) => ({ id, pages: [{ pageOffset: 0, width: 595, height: 842 }] })

  it('keeps the previous document visible while a compile is pending', () => {
    const state: PreviewBufferState = { rendered: doc('doc-1'), pending: false }
    const next = applyDoubleBufferUpdate(state, { type: 'compile-start' })
    expect(next.rendered?.id).toBe('doc-1')
    expect(next.pending).toBe(true)
  })

  it('swaps in the new document only when the compile succeeds', () => {
    let state: PreviewBufferState = { rendered: doc('doc-1'), pending: true }
    state = applyDoubleBufferUpdate(state, { type: 'compile-success', document: doc('doc-2') })
    expect(state.rendered?.id).toBe('doc-2')
    expect(state.pending).toBe(false)
  })

  it('keeps the previous document when a compile fails', () => {
    let state: PreviewBufferState = { rendered: doc('doc-1'), pending: true }
    state = applyDoubleBufferUpdate(state, { type: 'compile-error', message: 'boom' })
    expect(state.rendered?.id).toBe('doc-1')
    expect(state.pending).toBe(false)
  })

  it('drops the buffer only on a source switch, not on errors', () => {
    let state: PreviewBufferState = { rendered: doc('doc-1'), pending: true }
    state = applyDoubleBufferUpdate(state, { type: 'source-switch' })
    expect(state.rendered).toBeNull()
    expect(state.pending).toBe(false)
  })

  it('ignores success results that were superseded by a newer version', () => {
    let state: PreviewBufferState = { rendered: doc('doc-1'), pending: true }
    state = applyDoubleBufferUpdate(state, {
      type: 'compile-success',
      document: doc('doc-9'),
      renderVersion: 3,
      currentRenderVersion: 4,
    })
    expect(state.rendered?.id).toBe('doc-1')
    expect(state.pending).toBe(true)
  })
})

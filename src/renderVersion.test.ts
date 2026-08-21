import { describe, expect, it } from 'vitest'
import {
  createRenderVersionGate,
  invalidateRenderSynchronously,
  synchronizeRenderTransition,
} from './renderVersion'

describe('render version gate', () => {
  it('rejects an in-flight result after the source becomes empty', () => {
    const gate = createRenderVersionGate()
    const rendering = gate.begin()

    gate.invalidate()

    expect(gate.isCurrent(rendering)).toBe(false)
  })

  it('rejects an in-flight result when a long-file edit disables auto preview', () => {
    const gate = createRenderVersionGate()
    const rendering = gate.begin()

    gate.invalidate()

    expect(gate.isCurrent(rendering)).toBe(false)
  })

  it('rejects a result from the previously active file', () => {
    const gate = createRenderVersionGate()
    const previousFile = gate.begin()

    gate.invalidate()
    const currentFile = gate.begin()

    expect(gate.isCurrent(previousFile)).toBe(false)
    expect(gate.isCurrent(currentFile)).toBe(true)
  })

  it('settles rendering state synchronously while invalidating', () => {
    const gate = createRenderVersionGate()
    const rendering = gate.begin()
    let previewState = 'rendering'

    invalidateRenderSynchronously(gate, () => {
      previewState = 'idle'
    })

    expect(previewState).toBe('idle')
    expect(gate.isCurrent(rendering)).toBe(false)
  })

  it('discards pending and debounced work on a non-rendering transition', () => {
    const gate = createRenderVersionGate()
    const rendering = gate.begin()
    const latestSource = { current: 'pending B' }
    const pending = { current: true }
    const timer = { current: 42 as number | null }
    const clearedTimers: number[] = []
    let previewState = 'rendering'

    synchronizeRenderTransition({
      gate,
      source: 'long C',
      latestSource,
      pending,
      timer,
      clearTimer: (id: number) => clearedTimers.push(id),
      settlePreview: () => {
        previewState = 'idle'
      },
    })

    expect(latestSource.current).toBe('long C')
    expect(pending.current).toBe(false)
    expect(timer.current).toBeNull()
    expect(clearedTimers).toEqual([42])
    expect(previewState).toBe('idle')
    expect(gate.isCurrent(rendering)).toBe(false)
  })

  it('accepts only the newest out-of-order completion', () => {
    const gate = createRenderVersionGate()
    const first = gate.begin()
    const second = gate.begin()

    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
  })
})

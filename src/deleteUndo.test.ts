import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDeleteIntent,
  isUndoWindowOpen,
  UNDO_WINDOW_MS,
} from './deleteUndo'
import type { StoredFile } from './storage'

const makeFile = (): StoredFile => ({
  id: 'file-1',
  name: 'Hello.typ',
  content: '= Hello',
  updatedAt: 1234,
})

describe('createDeleteIntent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(50_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('captures the file and the current time', () => {
    const file = makeFile()
    const intent = createDeleteIntent(file)

    expect(intent.file).toBe(file)
    expect(intent.deletedAt).toBe(50_000)
  })
})

describe('isUndoWindowOpen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is open immediately after creation', () => {
    const intent = createDeleteIntent(makeFile())
    expect(isUndoWindowOpen(intent, intent.deletedAt)).toBe(true)
  })

  it('stays open just before the window elapses', () => {
    const intent = createDeleteIntent(makeFile())
    expect(isUndoWindowOpen(intent, intent.deletedAt + UNDO_WINDOW_MS - 1)).toBe(
      true,
    )
  })

  it('closes exactly at the window boundary', () => {
    const intent = createDeleteIntent(makeFile())
    expect(isUndoWindowOpen(intent, intent.deletedAt + UNDO_WINDOW_MS)).toBe(
      false,
    )
  })

  it('is closed well after the window', () => {
    const intent = createDeleteIntent(makeFile())
    expect(
      isUndoWindowOpen(intent, intent.deletedAt + UNDO_WINDOW_MS * 10),
    ).toBe(false)
  })
})

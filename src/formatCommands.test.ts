import { describe, expect, it } from 'vitest'
import {
  computeFormatEdit,
  type FormatMarker,
} from './formatCommands'

describe('typst.app-style format wrapping', () => {
  const bold: FormatMarker = { open: '*', close: '*' }
  const italic: FormatMarker = { open: '_', close: '_' }

  it('wraps a selection with the marker', () => {
    const edit = computeFormatEdit({ text: 'hello world', from: 0, to: 5 }, bold)
    expect(edit.text).toBe('*hello* world')
    expect(edit.selectionFrom).toBe(1)
    expect(edit.selectionTo).toBe(6)
  })

  it('unwraps when the selection is already fully wrapped', () => {
    const edit = computeFormatEdit({ text: '*hello* world', from: 0, to: 7 }, bold)
    expect(edit.text).toBe('hello world')
    expect(edit.selectionFrom).toBe(0)
    expect(edit.selectionTo).toBe(5)
  })

  it('inserts an empty marker pair and centers the cursor without a selection', () => {
    const edit = computeFormatEdit({ text: 'ab', from: 1, to: 1 }, italic)
    expect(edit.text).toBe('a__b')
    expect(edit.cursor).toBe(2)
    expect(edit.selectionFrom).toBeUndefined()
  })

  it('does not unwrap when only one side of the selection is a marker', () => {
    const edit = computeFormatEdit({ text: '*hello world', from: 0, to: 12 }, bold)
    expect(edit.text.startsWith('*')).toBe(true)
  })
})

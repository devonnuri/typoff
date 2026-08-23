import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { createEditorKeymapExtensions } from './editorKeys'

describe('createEditorKeymapExtensions', () => {
  it('configures the indent unit to two spaces', () => {
    const state = EditorState.create({
      extensions: createEditorKeymapExtensions(),
    })

    expect(state.facet(indentUnit)).toBe('  ')
  })

  it('returns an array of extensions', () => {
    const extensions = createEditorKeymapExtensions()

    expect(Array.isArray(extensions)).toBe(true)
    expect(extensions.length).toBeGreaterThan(0)
  })
})

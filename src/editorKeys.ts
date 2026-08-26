import { indentUnit } from '@codemirror/language'
import { acceptCompletion } from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { keymap } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import {
  computeFormatEdit,
  EMPH_MARKER,
  STRONG_MARKER,
} from './formatCommands'
import { toggleLineComment } from './commentCommand'

// Typst convention: indent with two spaces.
export function createEditorKeymapExtensions() {
  return [
    indentUnit.of('  '),
    keymap.of([
      { key: 'Tab', run: acceptCompletion },
      indentWithTab,
      {
        key: 'Mod-b',
        run: (view) => applyFormat(view, STRONG_MARKER),
      },
      {
        key: 'Mod-i',
        run: (view) => applyFormat(view, EMPH_MARKER),
      },
      {
        key: 'Mod-/',
        run: applyCommentToggle,
      },
    ]),
  ]
}

function applyCommentToggle(
  view: import('@codemirror/view').EditorView,
): boolean {
  const { state } = view
  const range = state.selection.main
  const result = toggleLineComment({
    text: state.doc.toString(),
    from: range.from,
    to: range.to,
  })
  if (result.text === state.doc.toString()) {
    return false
  }
  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: result.text },
    selection: EditorSelection.range(result.from, result.to),
  })
  return true
}

function applyFormat(
  view: import('@codemirror/view').EditorView,
  marker: import('./formatCommands').FormatMarker,
): boolean {
  const { state } = view
  const range = state.selection.main
  const edit = computeFormatEdit(
    { text: state.doc.toString(), from: range.from, to: range.to },
    marker,
  )
  if (edit.text === state.doc.toString()) {
    return false
  }
  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: edit.text },
    selection: EditorSelection.single(
      edit.selectionFrom !== undefined && edit.selectionTo !== undefined
        ? edit.selectionFrom // anchor at wrap start
        : (edit.cursor ?? range.head),
      edit.selectionFrom !== undefined && edit.selectionTo !== undefined
        ? edit.selectionTo
        : (edit.cursor ?? range.head),
    ),
  })
  return true
}

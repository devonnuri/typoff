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
import { shouldAutoCloseMath } from './mathAutoclose'

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
      {
        key: '$',
        run: autoCloseMath,
      },
    ]),
  ]
}

function autoCloseMath(view: import('@codemirror/view').EditorView): boolean {
  const { state } = view
  const range = state.selection.main
  if (!range.empty) {
    return false // let the default handler wrap/insert normally
  }
  const pos = range.head
  const before = state.doc.sliceString(0, pos)
  const after = state.doc.sliceString(pos)
  if (!shouldAutoCloseMath({ before, after })) {
    return false
  }
  view.dispatch({
    changes: { from: pos, insert: '$$' },
    selection: EditorSelection.cursor(pos + 1),
  })
  return true
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

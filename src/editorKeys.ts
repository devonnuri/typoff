import { indentUnit } from '@codemirror/language'
import { acceptCompletion } from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { keymap } from '@codemirror/view'

// Typst convention: indent with two spaces.
export function createEditorKeymapExtensions() {
  return [
    indentUnit.of('  '),
    keymap.of([
      { key: 'Tab', run: acceptCompletion },
      indentWithTab,
    ]),
  ]
}

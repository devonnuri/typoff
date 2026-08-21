import { useEffect, useRef } from 'react'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  type DecorationSet,
} from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { TYPOFF_DARK_PALETTE } from './editorTheme'
import { typstLanguage } from './typstLanguage'
import {
  positionFromDiagnostic,
  type TypstDiagnostic,
} from './typstWorkspace'

type DiagnosticMarker = {
  from: number
  to: number
  severity: TypstDiagnostic['severity']
  message: string
}

const setDiagnosticMarkers = StateEffect.define<DiagnosticMarker[]>()
const diagnosticMarkers = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(markers, transaction) {
    let next = markers.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setDiagnosticMarkers)) {
        next = Decoration.set(
          effect.value.map((marker) =>
            Decoration.mark({
              class: `cm-typst-diagnostic cm-typst-${marker.severity}`,
              attributes: { title: marker.message },
            }).range(marker.from, marker.to),
          ),
          true,
        )
      }
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

const editorTheme = EditorView.theme(
  {
    '&': {
      color: TYPOFF_DARK_PALETTE.foreground,
      backgroundColor: TYPOFF_DARK_PALETTE.background,
      fontFamily: '"IBM Plex Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '14px',
      height: '100%',
    },
    '.cm-content': {
      padding: '20px 18px 40px',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
    '.cm-gutters': {
      backgroundColor: TYPOFF_DARK_PALETTE.background,
      border: 'none',
      color: TYPOFF_DARK_PALETTE.tokens.comment,
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(94, 234, 212, 0.08)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: TYPOFF_DARK_PALETTE.accent,
    },
    '.cm-cursor': {
      borderLeftColor: TYPOFF_DARK_PALETTE.accent,
    },
  },
  { dark: true },
)

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: TYPOFF_DARK_PALETTE.tokens.keyword, fontWeight: '600' },
  { tag: tags.string, color: TYPOFF_DARK_PALETTE.tokens.string },
  { tag: tags.number, color: TYPOFF_DARK_PALETTE.tokens.number },
  { tag: tags.comment, color: TYPOFF_DARK_PALETTE.tokens.comment, fontStyle: 'italic' },
  { tag: tags.operator, color: TYPOFF_DARK_PALETTE.tokens.operator, fontWeight: '600' },
  { tag: tags.strong, color: TYPOFF_DARK_PALETTE.tokens.operator, fontWeight: '700' },
  { tag: tags.atom, color: TYPOFF_DARK_PALETTE.tokens.atom },
])

type TypstEditorProps = {
  value: string
  path: string
  diagnostics: TypstDiagnostic[]
  onChange: (value: string) => void
}

export function TypstEditor({ value, path, diagnostics, onChange }: TypstEditorProps) {
  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!editorHostRef.current) {
      return
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        typstLanguage,
        syntaxHighlighting(highlightStyle),
        diagnosticMarkers,
        editorTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
    })

    const view = new EditorView({ state, parent: editorHostRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }

    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }

    const markers = diagnostics
      .filter((diagnostic) => diagnostic.path === path)
      .flatMap((diagnostic) => {
        const position = positionFromDiagnostic(value, diagnostic)
        return position
          ? [{ ...position, severity: diagnostic.severity, message: diagnostic.message }]
          : []
      })
    view.dispatch({ effects: setDiagnosticMarkers.of(markers) })
  }, [diagnostics, path, value])

  return <div className="editor-host" ref={editorHostRef} />
}

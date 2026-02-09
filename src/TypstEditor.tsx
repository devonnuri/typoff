import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { typstLanguage } from './typstLanguage'

const editorTheme = EditorView.theme({
  '&': {
    fontFamily: '"IBM Plex Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '14px',
    height: '100%',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    padding: '20px 18px 40px',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(6, 95, 70, 0.08)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#0f766e',
  },
  '.cm-cursor': {
    borderLeftColor: '#0f766e',
  },
})

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#0f766e', fontWeight: '600' },
  { tag: tags.string, color: '#b45309' },
  { tag: tags.number, color: '#ea580c' },
  { tag: tags.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: tags.operator, color: '#1f2937' },
  { tag: tags.atom, color: '#2563eb' },
])

type TypstEditorProps = {
  value: string
  onChange: (value: string) => void
}

export function TypstEditor({ value, onChange }: TypstEditorProps) {
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
        editorTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: editorHostRef.current,
    })

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
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      })
    }
  }, [value])

  return <div className="editor-host" ref={editorHostRef} />
}

import { StreamLanguage } from '@codemirror/language'

const KEYWORDS = /\b(set|show|let|import|include|if|else|for|in|while|break|continue|return|context|align|page|text|figure|table|heading)\b/

export const typstLanguage = StreamLanguage.define({
  startState() {
    return { inBlockComment: false }
  },
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.skipTo('*/')) {
        stream.match('*/')
        state.inBlockComment = false
      } else {
        stream.skipToEnd()
      }
      return 'comment'
    }

    if (stream.match('/*')) {
      state.inBlockComment = true
      return 'comment'
    }

    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }

    if (stream.match(/"(?:[^\\"]|\\.)*"/)) {
      return 'string'
    }

    if (stream.match(/`[^`]*`/)) {
      return 'string'
    }

    if (stream.match(/\$[^$]*\$/)) {
      return 'atom'
    }

    if (stream.match(/\b\d+(?:\.\d+)?\b/)) {
      return 'number'
    }

    if (stream.match(/#\s*[a-zA-Z_][\w-]*/)) {
      return 'keyword'
    }

    if (stream.match(KEYWORDS)) {
      return 'keyword'
    }

    if (stream.match(/(\*{1,2}|_{1,2}|==|!=|<=|>=|->|<-)/)) {
      return 'operator'
    }

    stream.next()
    return null
  },
})

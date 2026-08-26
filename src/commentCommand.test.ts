import { describe, expect, it } from 'vitest'
import { toggleLineComment } from './commentCommand'

describe('line comment toggling', () => {
  it('comments every line the selection touches', () => {
    const result = toggleLineComment({ text: 'abc\ndef\nghi', from: 2, to: 8 })
    expect(result.text).toBe('// abc\n// def\n// ghi')
  })

  it('uncomments lines that are all commented', () => {
    const result = toggleLineComment({
      text: '// abc\n// def',
      from: 0,
      to: 12,
    })
    expect(result.text).toBe('abc\ndef')
  })

  it('comments a single line when there is no selection', () => {
    const result = toggleLineComment({ text: 'abc\ndef', from: 1, to: 1 })
    expect(result.text).toBe('// abc\ndef')
  })

  it('toggling twice returns the original text', () => {
    const once = toggleLineComment({ text: '// a\nb', from: 0, to: 4 })
    const twice = toggleLineComment({ text: once.text, from: once.from, to: once.to })
    expect(twice.text).toBe('// a\nb')
  })
})

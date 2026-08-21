import { describe, expect, it } from 'vitest'
import {
  buildTypstWorkspace,
  normalizeDiagnostic,
  positionFromDiagnostic,
} from './typstWorkspace'

describe('Typst workspace', () => {
  it('mounts every file and uses the unsaved active content as main', () => {
    const workspace = buildTypstWorkspace(
      [
        { id: 'main', name: 'main.typ', content: '#import "parts/math.typ"' },
        { id: 'math', name: 'parts/math.typ', content: 'old' },
      ],
      'math',
      'new',
    )

    expect(workspace).toEqual({
      mainFilePath: '/@memory/parts/math.typ',
      files: [
        { path: '/@memory/main.typ', content: '#import "parts/math.typ"' },
        { path: '/@memory/parts/math.typ', content: 'new' },
      ],
    })
  })

  it('rejects absolute, parent-traversal, and duplicate virtual paths', () => {
    expect(() =>
      buildTypstWorkspace([{ id: '1', name: '../secret.typ', content: '' }], '1', ''),
    ).toThrow(/parent directory/i)
    expect(() =>
      buildTypstWorkspace([{ id: '1', name: '/root.typ', content: '' }], '1', ''),
    ).toThrow(/relative/i)
    expect(() =>
      buildTypstWorkspace(
        [
          { id: '1', name: 'same.typ', content: '' },
          { id: '2', name: 'same.typ', content: '' },
        ],
        '1',
        '',
      ),
    ).toThrow(/duplicate/i)
  })
})

describe('Typst diagnostics', () => {
  it('normalizes a full diagnostic into human-readable structured data', () => {
    expect(
      normalizeDiagnostic({
        severity: 'Error',
        path: '/main.typ',
        package: '',
        range: '1:8-1:9',
        message: 'expected expression',
      }),
    ).toEqual({
      severity: 'error',
      path: '/main.typ',
      package: '',
      message: 'expected expression',
      range: {
        start: { line: 1, column: 8 },
        end: { line: 1, column: 9 },
      },
      rawRange: '1:8-1:9',
    })
  })

  it('converts zero-based Unicode code-point columns to UTF-16 offsets', () => {
    const source = '#let x = "😀" + nope'
    const diagnostic = normalizeDiagnostic({
      severity: 'error',
      path: '/main.typ',
      range: '0:15-0:19',
      message: 'unknown variable',
    })

    expect(positionFromDiagnostic(source, diagnostic)).toEqual({ from: 16, to: 20 })
  })

  it('keeps zero-width end-of-file diagnostics inside the document', () => {
    const source = '#let x ='
    const diagnostic = normalizeDiagnostic({
      severity: 'error',
      path: '/main.typ',
      range: '0:8-0:8',
      message: 'expected expression',
    })

    expect(positionFromDiagnostic(source, diagnostic)).toEqual({ from: 7, to: 8 })
  })

  it('maps a diagnostic range to safe CodeMirror offsets', () => {
    const source = 'first\nsecond line\nthird'
    const diagnostic = normalizeDiagnostic({
      severity: 'error',
      path: '/main.typ',
      range: '1:1-1:7',
      message: 'bad expression',
    })

    expect(positionFromDiagnostic(source, diagnostic)).toEqual({ from: 7, to: 13 })
  })
})

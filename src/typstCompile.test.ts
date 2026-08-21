import { describe, expect, it } from 'vitest'
import { compileTypstWorkspace, createSerialExecutor } from './typstCompile'

const workspace = {
  mainFilePath: '/@memory/main.typ',
  files: [
    { path: '/@memory/main.typ', content: '#import "shared.typ"' },
    { path: '/@memory/shared.typ', content: '= Shared' },
  ],
}

describe('compileTypstWorkspace', () => {
  it('resets and mounts the complete workspace before compiling', async () => {
    const calls: unknown[] = []
    const runtime = {
      resetShadow: () => {
        calls.push('reset')
      },
      addSource: (path: string, content: string) => {
        calls.push(['source', path, content])
      },
      compile: async (options: unknown) => {
        calls.push(['compile', options])
        return { result: new Uint8Array([1, 2, 3]), diagnostics: [] }
      },
      renderVector: async (vector: Uint8Array) => {
        calls.push(['render', [...vector]])
        return '<svg />'
      },
    }

    await expect(compileTypstWorkspace(runtime, workspace, {})).resolves.toEqual({
      svg: '<svg />',
      diagnostics: [],
    })
    expect(calls).toEqual([
      'reset',
      ['source', '/@memory/main.typ', '#import "shared.typ"'],
      ['source', '/@memory/shared.typ', '= Shared'],
      ['compile', { mainFilePath: '/@memory/main.typ', root: '/@memory', diagnostics: 'full' }],
      ['render', [1, 2, 3]],
    ])
  })

  it('returns normalized diagnostics and skips rendering on compile errors', async () => {
    let rendered = false
    const runtime = {
      resetShadow() {},
      addSource() {},
      async compile() {
        return {
          diagnostics: [
            {
              severity: 'Error',
              path: '/main.typ',
              range: '1:2-1:3',
              message: 'expected expression',
            },
          ],
        }
      },
      async renderVector() {
        rendered = true
        return '<svg />'
      },
    }

    const result = await compileTypstWorkspace(runtime, workspace, {})

    expect(result.svg).toBe('')
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      path: '/main.typ',
      message: 'expected expression',
    })
    expect(rendered).toBe(false)
  })
})

describe('serial render execution', () => {
  it('does not start a second mutable compiler job before the first settles', async () => {
    const started: number[] = []
    let finishFirst: (() => void) | undefined
    const execute = createSerialExecutor()

    const first = execute(
      () =>
        new Promise<void>((resolve) => {
          started.push(1)
          finishFirst = resolve
        }),
    )
    const second = execute(async () => {
      started.push(2)
    })

    await Promise.resolve()
    expect(started).toEqual([1])

    finishFirst?.()
    await first
    await second
    expect(started).toEqual([1, 2])
  })
})

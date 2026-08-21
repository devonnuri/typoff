import { describe, expect, it } from 'vitest'
import {
  compileTypstWorkspace,
  createSerialExecutor,
  locateTypstCursorPage,
} from './typstCompile'

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
    }

    await expect(compileTypstWorkspace(runtime, workspace)).resolves.toEqual({
      artifact: new Uint8Array([1, 2, 3]),
      diagnostics: [],
    })
    expect(calls).toEqual([
      'reset',
      ['source', '/@memory/main.typ', '#import "shared.typ"'],
      ['source', '/@memory/shared.typ', '= Shared'],
      ['compile', { mainFilePath: '/@memory/main.typ', root: '/@memory', diagnostics: 'full' }],

    ])
  })

  it('returns normalized diagnostics and skips rendering on compile errors', async () => {
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
    }

    const result = await compileTypstWorkspace(runtime, workspace)

    expect(result.artifact).toBeUndefined()
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      path: '/main.typ',
      message: 'expected expression',
    })

  })
})

describe('cursor page lookup', () => {
  it('inserts a zero-sized metadata marker at the cursor line and queries its page', async () => {
    const sources = new Map<string, string>()
    let queryOptions: unknown
    const runtime = {
      resetShadow() {
        sources.clear()
      },
      addSource(path: string, content: string) {
        sources.set(path, content)
      },
      async query(options: unknown) {
        queryOptions = options
        return [3]
      },
    }
    const cursorWorkspace = {
      mainFilePath: '/@memory/main.typ',
      files: [{ path: '/@memory/main.typ', content: 'First line\nSecond line' }],
    }

    await expect(
      locateTypstCursorPage(runtime, cursorWorkspace, 15, 'typoff-cursor-test'),
    ).resolves.toBe(2)
    expect(sources.get('/@memory/main.typ')).toBe(
      'First line\n#context [#metadata(here().page()) <typoff-cursor-test>]\nSecond line',
    )
    expect(queryOptions).toEqual({
      mainFilePath: '/@memory/main.typ',
      root: '/@memory',
      selector: '<typoff-cursor-test>',
      field: 'value',
    })
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

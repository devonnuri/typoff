import { describe, expect, it } from 'vitest'
import {
  collectSourceJumpPoints,
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

describe('source jump points', () => {
  const MARKER = '#context [#metadata((page: here().page(), y: here().position().y))]'

  function createCapturingRuntime(queryResult: unknown) {
    const sources = new Map<string, string>()
    const queryCalls: unknown[] = []
    return {
      runtime: {
        resetShadow() {
          sources.clear()
        },
        addSource(path: string, content: string) {
          sources.set(path, content)
        },
        async query(options: unknown) {
          queryCalls.push(options)
          return queryResult
        },
      },
      sources,
      queryCalls,
    }
  }

  it('inserts the marker at every line start without adding a newline', async () => {
    const { runtime, sources } = createCapturingRuntime([
      { page: 1, y: 10 },
      { page: 1, y: 20 },
      { page: 1, y: 30 },
    ])
    const jumpWorkspace = {
      mainFilePath: '/@memory/main.typ',
      files: [
        { path: '/@memory/main.typ', content: 'First line\nSecond line\nThird line' },
        { path: '/@memory/shared.typ', content: '= Shared' },
      ],
    }

    await collectSourceJumpPoints(runtime, jumpWorkspace)

    expect(sources.get('/@memory/main.typ')).toBe(
      `${MARKER}First line\n${MARKER}Second line\n${MARKER}Third line`,
    )
    // No added newline: removing every marker reconstructs the original.
    const instrumented = sources.get('/@memory/main.typ') ?? ''
    expect(instrumented.split(MARKER).join('')).toBe(
      'First line\nSecond line\nThird line',
    )
  })

  it('reconstructs correctly when a trailing newline exists', async () => {
    const { runtime, sources } = createCapturingRuntime([
      { page: 1, y: 10 },
      { page: 1, y: 20 },
    ])
    const jumpWorkspace = {
      mainFilePath: '/@memory/main.typ',
      files: [{ path: '/@memory/main.typ', content: 'One\nTwo\n' }],
    }

    await collectSourceJumpPoints(runtime, jumpWorkspace)

    // The trailing newline's end-of-content duplicate start is skipped.
    expect(sources.get('/@memory/main.typ')).toBe(
      `${MARKER}One\n${MARKER}Two\n`,
    )
  })

  it('queries all metadata values and filters foreign records before zipping', async () => {
    const { runtime, sources, queryCalls } = createCapturingRuntime([
      { note: 'user metadata' },
      { page: 1, y: 12.5 },
      'a plain string',
      { page: 'nope', y: 3 },
      { page: 2, y: 40 },
      null,
      { page: -1, y: 0 },
      Number.NaN,
      { y: 5 },
      { page: 2, y: 90 },
    ])
    const jumpWorkspace = {
      mainFilePath: '/@memory/main.typ',
      files: [
        { path: '/@memory/main.typ', content: '#metadata("foreign")\nAlpha\nBeta' },
      ],
    }

    const points = await collectSourceJumpPoints(runtime, jumpWorkspace)

    expect(queryCalls[0]).toEqual({
      mainFilePath: '/@memory/main.typ',
      root: '/@memory',
      selector: 'metadata',
      field: 'value',
    })
    expect(sources.get('/@memory/main.typ')).toContain('#metadata("foreign")')
    // Zip keeps document order of OUR entries: offsets 0, then line starts.
    expect(points).toEqual([
      { offset: 0, page: 1, y: 12.5 },
      { offset: 21, page: 2, y: 40 },
      { offset: 27, page: 2, y: 90 },
    ])
  })

  it('throws when the filtered metadata count does not match the line count', async () => {
    const { runtime } = createCapturingRuntime([{ page: 1, y: 1 }])
    const jumpWorkspace = {
      mainFilePath: '/@memory/main.typ',
      files: [{ path: '/@memory/main.typ', content: 'A\nB' }],
    }

    await expect(collectSourceJumpPoints(runtime, jumpWorkspace)).rejects.toThrow(
      'Typst source jump table is inconsistent',
    )
  })

  it('sorts the resulting points ascending by page then y', async () => {
    const { runtime } = createCapturingRuntime([
      { page: 2, y: 30 },
      { page: 1, y: 100 },
      { page: 1, y: 20 },
    ])
    const jumpWorkspace = {
      mainFilePath: '/@memory/main.typ',
      files: [{ path: '/@memory/main.typ', content: 'A\nB\nC' }],
    }

    await expect(collectSourceJumpPoints(runtime, jumpWorkspace)).resolves.toEqual([
      { offset: 4, page: 1, y: 20 },
      { offset: 2, page: 1, y: 100 },
      { offset: 0, page: 2, y: 30 },
    ])
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

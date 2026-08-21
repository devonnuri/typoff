import {
  normalizeDiagnostic,
  type TypstDiagnostic,
  type TypstWorkspace,
} from './typstWorkspace'

type CompileResult = {
  result?: Uint8Array
  diagnostics?: unknown[]
}

export type TypstCompileRuntime = {
  resetShadow(): void | Promise<void>
  addSource(path: string, content: string): void | Promise<void>
  compile(options: {
    mainFilePath: string
    root: string
    diagnostics: 'full'
  }): Promise<CompileResult>
}

export type TypstArtifactResult = {
  artifact?: Uint8Array
  diagnostics: TypstDiagnostic[]
}

export type TypstQueryRuntime = Pick<
  TypstCompileRuntime,
  'resetShadow' | 'addSource'
> & {
  query(options: {
    mainFilePath: string
    root: string
    selector: string
    field: string
  }): Promise<unknown>
}

export async function locateTypstCursorPage(
  runtime: TypstQueryRuntime,
  workspace: TypstWorkspace,
  offset: number,
  label: string,
): Promise<number> {
  const mainFile = workspace.files.find(
    (file) => file.path === workspace.mainFilePath,
  )
  if (!mainFile) {
    throw new Error('The active Typst source is missing from the workspace')
  }

  const safeOffset = Math.min(Math.max(0, offset), mainFile.content.length)
  const lineStart = mainFile.content.lastIndexOf('\n', safeOffset - 1) + 1
  const marker = `#context [#metadata(here().page()) <${label}>]\n`
  const instrumented = {
    ...workspace,
    files: workspace.files.map((file) =>
      file.path === workspace.mainFilePath
        ? {
            ...file,
            content:
              file.content.slice(0, lineStart) +
              marker +
              file.content.slice(lineStart),
          }
        : file,
    ),
  }

  await runtime.resetShadow()
  for (const file of instrumented.files) {
    await runtime.addSource(file.path, file.content)
  }
  const queried = await runtime.query({
    mainFilePath: instrumented.mainFilePath,
    root: '/@memory',
    selector: `<${label}>`,
    field: 'value',
  })
  const page = Array.isArray(queried) ? queried[0] : queried
  if (typeof page !== 'number' || !Number.isFinite(page) || page < 1) {
    throw new Error('Typst could not map the cursor to a preview page')
  }
  return Math.floor(page) - 1
}

export async function compileTypstWorkspace(
  runtime: TypstCompileRuntime,
  workspace: TypstWorkspace,
): Promise<TypstArtifactResult> {
  await runtime.resetShadow()
  for (const file of workspace.files) {
    await runtime.addSource(file.path, file.content)
  }

  const result = await runtime.compile({
    mainFilePath: workspace.mainFilePath,
    root: '/@memory',
    diagnostics: 'full',
  })
  const diagnostics = (result.diagnostics ?? []).map(normalizeDiagnostic)
  if (!result.result || diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { diagnostics }
  }

  return { artifact: result.result, diagnostics }
}

export function createSerialExecutor() {
  let tail: Promise<unknown> = Promise.resolve()

  return function execute<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

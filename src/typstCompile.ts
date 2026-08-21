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

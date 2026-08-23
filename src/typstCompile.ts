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

export interface SourceJumpPoint {
  offset: number
  page: number
  y: number
}

const SOURCE_JUMP_MARKER =
  '#context [#metadata((page: here().page(), y: here().position().y))]'

/**
 * Maps every line start of the main source file to its preview location by
 * inserting zero-width metadata markers (no added newline, so paragraph
 * layout stays approximately intact) and querying their positions in one pass.
 */
export async function collectSourceJumpPoints(
  runtime: TypstQueryRuntime,
  workspace: TypstWorkspace,
): Promise<SourceJumpPoint[]> {
  const mainFile = workspace.files.find(
    (file) => file.path === workspace.mainFilePath,
  )
  if (!mainFile) {
    throw new Error('The active Typst source is missing from the workspace')
  }

  // Line starts: offset 0 plus every index right after a newline. A trailing
  // newline would produce an end-of-content duplicate start, which we skip.
  const offsets: number[] = []
  for (let index = 0; index <= mainFile.content.length; index++) {
    const isLineStart =
      index === 0 || mainFile.content[index - 1] === '\n'
    const isEndOfContentDuplicate =
      index > 0 && index === mainFile.content.length
    if (isLineStart && !isEndOfContentDuplicate) {
      offsets.push(index)
    }
  }

  // Insert from the LAST offset backwards so earlier indices stay valid.
  let instrumentedContent = mainFile.content
  for (let index = offsets.length - 1; index >= 0; index--) {
    const offset = offsets[index]
    instrumentedContent =
      instrumentedContent.slice(0, offset) +
      SOURCE_JUMP_MARKER +
      instrumentedContent.slice(offset)
  }

  const instrumented = {
    ...workspace,
    files: workspace.files.map((file) =>
      file.path === workspace.mainFilePath
        ? { ...file, content: instrumentedContent }
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
    selector: 'metadata',
    field: 'value',
  })
  if (!Array.isArray(queried)) {
    throw new Error('Typst source jump table is inconsistent')
  }

  // Foreign metadata from user code may be interleaved; keep only our
  // position records. Relative order of ours is preserved by this filtering.
  const positions: Array<{ page: number; y: number }> = []
  for (const value of queried) {
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { page?: unknown }).page === 'number' &&
      Number.isFinite((value as { page: number }).page) &&
      (value as { page: number }).page >= 1 &&
      typeof (value as { y?: unknown }).y === 'number' &&
      Number.isFinite((value as { y: number }).y)
    ) {
      positions.push({
        page: (value as { page: number }).page,
        y: (value as { y: number }).y,
      })
    }
  }

  if (positions.length !== offsets.length) {
    throw new Error('Typst source jump table is inconsistent')
  }

  const points: SourceJumpPoint[] = offsets.map((offset, index) => ({
    offset,
    page: positions[index].page,
    y: positions[index].y,
  }))
  return points.sort((a, b) => a.page - b.page || a.y - b.y)
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

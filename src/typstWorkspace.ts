export type TypstWorkspaceFile = {
  path: string
  content: string
}

export type TypstWorkspace = {
  mainFilePath: string
  files: TypstWorkspaceFile[]
}

type WorkspaceSourceFile = {
  id: string
  name: string
  content: string
}

export type DiagnosticPoint = {
  line: number
  column: number
}

export type TypstDiagnostic = {
  severity: 'error' | 'warning' | 'hint' | 'info'
  package: string
  path: string
  message: string
  range?: {
    start: DiagnosticPoint
    end: DiagnosticPoint
  }
  rawRange: string
}

export function toTypstVirtualPath(name: string): string {
  const normalized = name.replaceAll('\\', '/').trim()
  if (!normalized || normalized.startsWith('/')) {
    throw new Error('Typst file names must be relative paths')
  }

  const parts = normalized.split('/')
  if (parts.some((part) => part === '..')) {
    throw new Error('Typst file names cannot reference a parent directory')
  }
  if (parts.some((part) => part === '' || part === '.')) {
    throw new Error('Typst file names must use normalized relative paths')
  }

  return `/@memory/${parts.join('/')}`
}

export function buildTypstWorkspace(
  files: WorkspaceSourceFile[],
  activeFileId: string,
  activeContent: string,
): TypstWorkspace {
  const active = files.find((file) => file.id === activeFileId)
  if (!active) {
    throw new Error('The active Typst file is not in the workspace')
  }

  const seen = new Set<string>()
  const workspaceFiles = files.map((file) => {
    const path = toTypstVirtualPath(file.name)
    if (seen.has(path)) {
      throw new Error(`Duplicate Typst workspace path: ${path}`)
    }
    seen.add(path)
    return {
      path,
      content: file.id === activeFileId ? activeContent : file.content,
    }
  })

  return {
    mainFilePath: toTypstVirtualPath(active.name),
    files: workspaceFiles,
  }
}

function parsePoint(value: string): DiagnosticPoint | undefined {
  const match = /^(\d+):(\d+)$/.exec(value.trim())
  if (!match) {
    return undefined
  }
  return { line: Number(match[1]), column: Number(match[2]) }
}

function parseRange(value: unknown): TypstDiagnostic['range'] {
  if (typeof value !== 'string') {
    return undefined
  }
  const [startValue, endValue = startValue] = value.split('-', 2)
  const start = parsePoint(startValue)
  const end = parsePoint(endValue)
  return start && end ? { start, end } : undefined
}

export function normalizeDiagnostic(value: unknown): TypstDiagnostic {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const severity = String(raw.severity ?? 'error').toLowerCase()
  const normalizedSeverity: TypstDiagnostic['severity'] =
    severity === 'warning'
      ? 'warning'
      : severity === 'hint'
        ? 'hint'
        : severity === 'info'
          ? 'info'
          : 'error'
  const rawRange = typeof raw.range === 'string' ? raw.range : ''

  return {
    severity: normalizedSeverity,
    package: typeof raw.package === 'string' ? raw.package : '',
    path: typeof raw.path === 'string' ? raw.path : '',
    message: typeof raw.message === 'string' ? raw.message : 'Typst compilation failed',
    range: parseRange(rawRange),
    rawRange,
  }
}

function offsetAt(source: string, point: DiagnosticPoint): number {
  const lines = source.split('\n')
  const lineIndex = Math.max(0, Math.min(lines.length - 1, point.line))
  let offset = 0
  for (let index = 0; index < lineIndex; index += 1) {
    offset += lines[index].length + 1
  }
  const line = lines[lineIndex]
  let codePoints = 0
  let columnOffset = 0
  for (const character of line) {
    if (codePoints >= point.column) {
      break
    }
    columnOffset += character.length
    codePoints += 1
  }
  return offset + columnOffset
}

export function positionFromDiagnostic(
  source: string,
  diagnostic: TypstDiagnostic,
): { from: number; to: number } | undefined {
  if (!diagnostic.range || source.length === 0) {
    return undefined
  }
  let from = offsetAt(source, diagnostic.range.start)
  const rawTo = offsetAt(source, diagnostic.range.end)
  if (rawTo <= from) {
    if (from >= source.length) {
      from = source.length - 1
    }
    return { from, to: Math.min(source.length, from + 1) }
  }
  return { from, to: Math.min(source.length, rawTo) }
}

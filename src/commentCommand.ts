// Pure logic for the Cmd+/ line-comment toggle: prefix every touched line
// with `// `, or strip it when all touched lines are already commented.

export interface CommentToggleInput {
  text: string
  from: number
  to: number
}

export interface CommentToggleResult {
  text: string
  /** New selection covering the same lines after the edit. */
  from: number
  to: number
}

const PREFIX = '// '

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      starts.push(i + 1)
    }
  }
  return starts
}

function lineStartBefore(starts: number[], offset: number): number {
  let start = 0
  for (const candidate of starts) {
    if (candidate <= offset) {
      start = candidate
    } else {
      break
    }
  }
  return start
}

function lineEndAfter(text: string, offset: number): number {
  const index = text.indexOf('\n', offset)
  return index === -1 ? text.length : index
}

function allCommented(lines: string[]): boolean {
  return lines.every((line) => line.trim() === '' || line.trimStart().startsWith('//'))
}

function uncomment(lines: string[]): string[] {
  return lines.map((line) => line.replace(/^(\s*)\/\/ ?/, '$1'))
}

function comment(lines: string[]): string[] {
  return lines.map((line) => (line.trim() === '' ? line : PREFIX + line))
}

export function toggleLineComment(input: CommentToggleInput): CommentToggleResult {
  const { text } = input
  const firstStart = lineStartBefore(lineStarts(text), input.from)
  const lastEnd = lineEndAfter(text, input.to)
  const block = text.slice(firstStart, lastEnd)
  const lines = block.split('\n')

  const newLines = allCommented(lines) ? uncomment(lines) : comment(lines)
  const newBlock = newLines.join('\n')
  const delta = newBlock.length - block.length

  return {
    text: text.slice(0, firstStart) + newBlock + text.slice(lastEnd),
    from: firstStart,
    to: Math.max(firstStart, input.to + delta),
  }
}

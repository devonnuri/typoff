// Pure logic for auto-closing Typst math delimiters: typing `$` in markup
// inserts the matching closing `$` and places the cursor between them.

export interface MathContextInput {
  /** Document text before (not including) the typed `$`. */
  before: string
  /** Document text after the cursor. */
  after: string
}

/**
 * Counts unescaped `$` occurrences; an even count means we are outside math.
 * Escapes (`\$`) and raw blocks are approximated by skipping `\`-prefixed
 * characters, which matches how Typst tokenizes the common cases.
 */
function isOutsideMath(before: string): boolean {
  let count = 0
  for (let i = 0; i < before.length; i++) {
    if (before[i] === '\\') {
      i++
      continue
    }
    if (before[i] === '$') {
      count++
    }
  }
  return count % 2 === 0
}

export function shouldAutoCloseMath(input: MathContextInput): boolean {
  if (!isOutsideMath(input.before)) {
    return false
  }
  // A word character right after the cursor means the user is editing inside
  // existing text, not opening a fresh equation — do not insert a closer.
  if (/[\w$]/.test(input.after[0] ?? '')) {
    return false
  }
  return true
}

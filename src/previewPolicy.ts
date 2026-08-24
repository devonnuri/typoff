export type PreviewPolicy = {
  delayMs: number
}

const MEDIUM_FILE_LENGTH = 15_000
const LONG_FILE_LENGTH = 40_000

const FAST_COMPILE_MS = 150
const MEDIUM_COMPILE_MS = 600
const SLOW_COMPILE_MS = 3_000

const EMA_ALPHA = 0.3

let emaCompileMs: number | null = null

export function resetPreviewPolicyForTest(): void {
  emaCompileMs = null
}

export function recordCompileDuration(durationMs: number): void {
  emaCompileMs =
    emaCompileMs === null
      ? durationMs
      : EMA_ALPHA * durationMs + (1 - EMA_ALPHA) * emaCompileMs
}

function getMeasuredPolicy(emaMs: number): PreviewPolicy {
  if (emaMs > SLOW_COMPILE_MS) return { delayMs: 2_400 }
  if (emaMs >= MEDIUM_COMPILE_MS) return { delayMs: 1_200 }
  if (emaMs >= FAST_COMPILE_MS) return { delayMs: 400 }
  return { delayMs: 200 }
}

function getColdStartPolicy(sourceLength: number): PreviewPolicy {
  if (sourceLength > LONG_FILE_LENGTH) {
    return { delayMs: 2_400 }
  }

  if (sourceLength > MEDIUM_FILE_LENGTH) {
    return { delayMs: 1_200 }
  }

  return { delayMs: 400 }
}

// Preview is always automatic; the policy only picks how long typing is
// debounced before the next compile so large documents stay responsive.
export function getPreviewPolicy(sourceLength: number): PreviewPolicy {
  if (emaCompileMs !== null) {
    return getMeasuredPolicy(emaCompileMs)
  }

  return getColdStartPolicy(sourceLength)
}

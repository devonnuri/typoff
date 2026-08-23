export type PreviewPolicy = {
  auto: boolean
  delayMs: number
}

const MEDIUM_FILE_LENGTH = 15_000
const LONG_FILE_LENGTH = 20_000

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

function getMeasuredPolicy(emaMs: number): PreviewPolicy | null {
  if (emaMs > SLOW_COMPILE_MS) return { auto: false, delayMs: 0 }
  if (emaMs >= MEDIUM_COMPILE_MS) return { auto: true, delayMs: 1_200 }
  if (emaMs >= FAST_COMPILE_MS) return { auto: true, delayMs: 400 }
  if (emaMs >= 0) return { auto: true, delayMs: 200 }
  return null
}

function getColdStartPolicy(sourceLength: number): PreviewPolicy {
  if (sourceLength > LONG_FILE_LENGTH) {
    return { auto: false, delayMs: 0 }
  }

  if (sourceLength > MEDIUM_FILE_LENGTH) {
    return { auto: true, delayMs: 1_200 }
  }

  return { auto: true, delayMs: 400 }
}

export function getPreviewPolicy(sourceLength: number): PreviewPolicy {
  if (emaCompileMs !== null) {
    const measured = getMeasuredPolicy(emaCompileMs)
    if (measured) return measured
  }

  return getColdStartPolicy(sourceLength)
}
